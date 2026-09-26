"""Cloud TasksとFirestoreの永続化。ブラウザ情報は取り扱わない。"""
import json
from datetime import datetime, timedelta, timezone


class TaskQueue:
    def __init__(self, project, region, queue, worker_url, service_account):
        from google.cloud import tasks_v2
        self.client = tasks_v2.CloudTasksClient()
        self.parent = self.client.queue_path(project, region, queue)
        self.url = worker_url.rstrip("/") + "/tasks/process"
        self.audience = worker_url.rstrip("/")
        self.service_account = service_account

    def enqueue(self, work):
        from google.api_core.exceptions import AlreadyExists
        from google.cloud import tasks_v2
        task = {"name": self.parent + "/tasks/" + work.key,
                "http_request": {"http_method": tasks_v2.HttpMethod.POST, "url": self.url,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps(work.payload(), ensure_ascii=False).encode(),
                    "oidc_token": {"service_account_email": self.service_account, "audience": self.audience}},
                "dispatch_deadline": {"seconds": 300}}
        try:
            self.client.create_task(parent=self.parent, task=task, timeout=1.5, retry=None)
        except AlreadyExists:
            pass


class FirestoreStore:
    def __init__(self, project, collection="sales_qa_http_jobs"):
        from google.cloud import firestore
        self.db = firestore.Client(project=project)
        self.collection = self.db.collection(collection)

    def _change(self, key, fn):
        from google.cloud import firestore
        ref = self.collection.document(key)
        @firestore.transactional
        def change(transaction):
            old = ref.get(transaction=transaction).to_dict() or {}
            result, data = fn(old)
            if data is not None:
                transaction.set(ref, data, merge=True)
            return result
        return change(self.db.transaction())

    def claim(self, key, owner, now):
        def update(old):
            state = old.get("state")
            if state == "done":
                return "done", None
            if state == "posting" and old.get("lease_until", 0) > now:
                return "busy", None
            if state in {"posting", "uncertain"}:
                return "uncertain", {"state": "uncertain"}
            if state == "running" and old.get("lease_until", 0) > now:
                return "busy", None
            return "claimed", {"state": "running", "owner": owner, "lease_until": now + 360,
                               "updated_at": datetime.now(timezone.utc),
                               "expire_at": datetime.now(timezone.utc) + timedelta(days=30)}
        return self._change(key, update)

    def _owned(self, key, owner, target, **extra):
        def update(old):
            if old.get("owner") != owner:
                raise RuntimeError("LEASE_LOST")
            return target, {"state": target, "updated_at": datetime.now(timezone.utc), **extra}
        return self._change(key, update)

    def posting(self, key, owner, **metadata):
        return self._owned(key, owner, "posting", **metadata)

    def finish(self, key, owner, state, **extra):
        return self._owned(key, owner, state, **extra)

    def fail(self, key, owner):
        def update(old):
            if old.get("owner") != owner:
                raise RuntimeError("LEASE_LOST")
            state = "uncertain" if old.get("state") in {"posting", "uncertain"} else "retry"
            return state, {"state": state, "updated_at": datetime.now(timezone.utc)}
        return self._change(key, update)

    def reserve_alert(self, key, state="retry"):
        def update(old):
            states = old.get("alert_states", [])
            if state in states:
                return False, None
            return True, {"alert_states": [*states, state]}
        return self._change(key, update)
