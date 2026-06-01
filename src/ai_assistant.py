import os
import anthropic

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
"""


class AIAssistant:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        self.model = "claude-sonnet-4-6"

    def answer(
        self,
        user_question: str,
        qa_data: list[dict],
        corrections: list[dict] | None = None,
        service_materials: str = "",
    ) -> str:
        corrections_context = self._build_corrections_context(corrections or [])
        qa_context = self._build_qa_context(qa_data)

        user_content = f"""【営業メンバーからの質問】
{user_question}

【確定正解データ】（最優先で参照すること）
{corrections_context}

【過去のQ&Aログ】（補助参照）
{qa_context}
"""
        if service_materials:
            user_content += f"\n【サービス資料】\n{service_materials}"

        message = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        return message.content[0].text

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

    def _build_qa_context(self, qa_data: list[dict]) -> str:
        if not qa_data:
            return "（まだQ&Aデータがありません）"
        lines = []
        for i, qa in enumerate(qa_data[-100:], 1):  # 直近100件
            lines.append(f"Q{i}: {qa['question']}")
            if qa.get("answers"):
                lines.append(f"A{i}: {qa['answers'][:500]}")
            lines.append("")
        return "\n".join(lines)
