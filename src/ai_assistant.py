import os
import asyncio
import logging
import tempfile
import anthropic

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """あなたは営業支援AIアシスタントです。
社内の営業Q&Aデータベースとサービス資料をもとに、営業メンバーの質問に正確・簡潔に答えてください。

参照データの優先順位（必ずこの順で優先すること）:
1. 【確定正解データ】 → 最優先。過去に誤りを訂正した公式回答。
2. 【サービス資料】 → 次に参照。
3. 【過去のQ&Aログ】 → 補助的に参照。【確定正解データ】と矛盾する場合は無視する。

回答ルール:
- 不明な場合は「確認が必要です」と正直に伝える
- 箇条書きで読みやすく整理する
- Slack向けに絶対にMarkdownの## や ### は使わない（*太字* や • 箇条書きは使ってよい）

画像に関するルール:
- 質問に画像が添付されている場合は、その内容を踏まえて回答する
- 画像URLは回答テキストに含めない（システムが自動で末尾に付与する）
"""


class AIAssistant:
    def __init__(self):
        self.notebook_id = os.environ.get("NOTEBOOKLM_NOTEBOOK_ID")
        self._storage_path = self._prepare_storage()
        self._use_notebooklm = bool(self.notebook_id and self._storage_path)

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        self._claude = anthropic.Anthropic(api_key=api_key) if api_key else None

    def _prepare_storage(self) -> str | None:
        storage_json = os.environ.get("NOTEBOOKLM_STORAGE_JSON")
        if not storage_json:
            return None
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        tmp.write(storage_json)
        tmp.close()
        return tmp.name

    def answer(
        self,
        user_question: str,
        qa_data: list[dict],
        corrections: list[dict] | None = None,
        service_materials: str = "",
        image_urls: list[str] | None = None,
        image_data: list[tuple[str, str]] | None = None,
    ) -> tuple[str, list[str]]:
        """回答テキストと、参照Q&Aに紐づく画像URLリストのタプルを返す"""
        if self._use_notebooklm:
            try:
                return asyncio.run(self._ask_notebooklm(user_question)), []
            except Exception as e:
                logger.error(f"NotebookLM failed, falling back to Claude: {e}")

        if self._claude:
            return self._ask_claude(
                user_question, qa_data, corrections or [], service_materials,
                image_urls=image_urls, image_data=image_data,
            )

        raise RuntimeError("AI backend not configured. Set NOTEBOOKLM_* or ANTHROPIC_API_KEY.")

    async def _ask_notebooklm(self, question: str) -> str:
        from notebooklm import NotebookLMClient
        async with NotebookLMClient.from_storage(path=self._storage_path) as client:
            result = await client.chat.ask(self.notebook_id, question)
            return result.answer

    def _ask_claude(
        self,
        user_question: str,
        qa_data: list[dict],
        corrections: list[dict],
        service_materials: str,
        image_urls: list[str] | None = None,
        image_data: list[tuple[str, str]] | None = None,
    ) -> tuple[str, list[str]]:
        corrections_context = self._build_corrections_context(corrections)
        qa_context, ref_image_urls = self._build_qa_context(qa_data, user_question)

        text = f"""【営業メンバーからの質問】
{user_question}

【確定正解データ】（最優先で参照すること）
{corrections_context}

【過去のQ&Aログ】（補助参照）
{qa_context}
"""
        if service_materials:
            text += f"\n【サービス資料】\n{service_materials}"

        content: list = []
        for mime_type, b64_data in (image_data or [])[:3]:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mime_type, "data": b64_data},
            })
        content.append({"type": "text", "text": text})

        message = self._claude.messages.create(
            model="claude-sonnet-5",
            # Sonnet 5はthinkingを省略するとadaptiveでONになる。ここは4.6時点と
            # 同じ挙動（思考なし・max_tokens 1024）を保つため明示的に無効化する。
            thinking={"type": "disabled"},
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        # thinkingが有効なモデルではcontent[0]がThinkingBlockになりうるため決め打ちしない
        answer = "".join(b.text for b in message.content if b.type == "text")
        return answer, ref_image_urls

    def _build_corrections_context(self, corrections: list[dict]) -> str:
        if not corrections:
            return "（まだ確定正解データがありません）"
        lines = []
        for i, c in enumerate(corrections, 1):
            lines.append(f"Q{i}: {c['question']}")
            lines.append(f"A{i}: {c['correct_answer']}")
            if c.get("note"):
                lines.append(f"補足: {c['note']}")
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def _relevance_score(q1: str, q2: str) -> int:
        """4文字以上の共通部分文字列の数で関連度をスコアリング（日本語対応）"""
        if not q1 or not q2:
            return 0
        return sum(1 for i in range(len(q1) - 3) if q1[i:i+4] in q2)

    def _build_qa_context(self, qa_data: list[dict], user_question: str = "") -> tuple[str, list[str]]:
        if not qa_data:
            return "（まだQ&Aデータがありません）", []
        lines = []

        # 画像付きQ&Aのうち関連度上位3件の画像URLを収集
        with_images = [(qa, self._relevance_score(user_question, qa["question"])) for qa in qa_data if qa.get("image_urls")]
        with_images.sort(key=lambda x: x[1], reverse=True)
        ref_image_urls: list[str] = []
        for qa, score in with_images[:3]:
            if score > 0:
                ref_image_urls.extend(qa["image_urls"])

        for i, qa in enumerate(qa_data[-100:], 1):
            service = qa.get("service", "")
            prefix = f"[{service}] " if service else ""
            lines.append(f"Q{i}: {prefix}{qa['question']}")
            if qa.get("answers"):
                lines.append(f"A{i}: {qa['answers'][:500]}")
            if qa.get("image_urls"):
                lines.append(f"関連画像: {', '.join(qa['image_urls'])}")
            lines.append("")
        return "\n".join(lines), ref_image_urls
