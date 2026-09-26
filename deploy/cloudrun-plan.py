"""構築コマンドを表示するだけ。課金有効化・認証登録・Slack設定は自動変更しない。"""
import argparse
import shlex

parser = argparse.ArgumentParser()
parser.add_argument('--project', default='salesqaconnect')
parser.add_argument('--region', default='asia-northeast1')
parser.add_argument('--image', required=True)
parser.add_argument('--worker-url', required=True)
a = parser.parse_args()
p, region = a.project, a.region
receiver = f'sales-qa-receiver@{p}.iam.gserviceaccount.com'
worker = f'sales-qa-worker@{p}.iam.gserviceaccount.com'
caller = f'sales-qa-caller@{p}.iam.gserviceaccount.com'
commands = []
def add(*args):
    commands.append(['gcloud', *args, '--project', p, '--quiet'])
add('services','enable','run.googleapis.com','cloudtasks.googleapis.com','firestore.googleapis.com',
    'secretmanager.googleapis.com','artifactregistry.googleapis.com','cloudbuild.googleapis.com')
for name in ['sales-qa-receiver','sales-qa-worker','sales-qa-caller']:
    add('iam','service-accounts','create',name)
# 専用のsalesqaconnectを使用し、他案件のプロジェクトへ広い権限を追加しない。
for member, role in [(worker,'roles/datastore.user')]:
    add('projects','add-iam-policy-binding',p,'--member','serviceAccount:'+member,'--role',role)
add('firestore','databases','create','--location',region,'--type','firestore-native')
add('firestore','fields','ttls','update','expire_at','--collection-group','sales_qa_http_jobs','--enable-ttl')
add('tasks','queues','create','sales-qa','--location',region,'--max-concurrent-dispatches','1',
    '--max-dispatches-per-second','1','--max-attempts','8','--min-backoff','60s','--max-backoff','600s')
add('tasks','queues','add-iam-policy-binding','sales-qa','--location',region,
    '--member','serviceAccount:'+receiver,'--role','roles/cloudtasks.enqueuer')
add('iam','service-accounts','add-iam-policy-binding',caller,'--member','serviceAccount:'+receiver,'--role','roles/iam.serviceAccountUser')
for name, member in [('sales-qa-signing-secret',receiver),('sales-qa-slack-token',worker),('sales-qa-notebooklm',worker)]:
    add('secrets','add-iam-policy-binding',name,'--member','serviceAccount:'+member,'--role','roles/secretmanager.secretAccessor')
add('secrets','add-iam-policy-binding','sales-qa-notebooklm','--member','serviceAccount:'+worker,'--role','roles/secretmanager.secretVersionManager')
common = ','.join(['GOOGLE_CLOUD_PROJECT='+p,'SLACK_TEAM_ID=T1CSJ782K','BOT_USER_ID=U0B87Q9P99N',
                   'AI_CHANNEL_ID=D0B87Q9U54G','OWNER_ONLY=true','OWNER_USER_ID=U03JFKXG6C8',
                   'OWNER_DM_ID=D0B87Q9U54G','TASKS_SERVICE_ACCOUNT='+caller,
                   'WORKER_URL='+a.worker_url,'NOTEBOOKLM_NOTEBOOK_ID=ff4df3ed-ae9a-4684-a8d1-8b00a8833ba0'])
add('run','deploy','sales-qa-worker','--region',region,'--image',a.image,'--service-account',worker,
    '--no-allow-unauthenticated','--max-instances','1','--concurrency','1','--timeout','300',
    '--min-instances','0','--memory','512Mi','--set-env-vars',common+',HTTP_ROLE=worker',
    '--set-secrets','SLACK_BOT_TOKEN=sales-qa-slack-token:latest')
add('run','services','add-iam-policy-binding','sales-qa-worker','--region',region,
    '--member','serviceAccount:'+caller,'--role','roles/run.invoker')
add('run','deploy','sales-qa-receiver','--region',region,'--image',a.image,'--service-account',receiver,
    '--allow-unauthenticated','--max-instances','2','--concurrency','10','--timeout','10',
    '--min-instances','0','--memory','256Mi','--set-env-vars',common+',HTTP_ROLE=receiver,HTTP_THREADS=10,TASKS_REGION='+region+',TASKS_QUEUE=sales-qa',
    '--set-secrets','SLACK_SIGNING_SECRET=sales-qa-signing-secret:latest')
# 定期起動はgas/HttpClock.js。GAS実行者へqueue enqueuerとcallerのactAsを付与する。
for command in commands:
    print(shlex.join(command))
