"use client";

import { useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Space, Typography } from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import { ASK_AI_GROUNDING_NOTE, ASK_AI_MAX_QUESTION_LENGTH } from "@/lib/ai/ask-prompt";

export interface AskAiExchange {
  question: string;
  answer: string;
  askedAt: string;
}

/**
 * History is per person and per browser on purpose: a question can quote what
 * someone was working on, and nobody agreed to share that with the rest of the
 * company. It never leaves this device.
 */
const HISTORY_KEY = "one-book.ask-ai.history";
const HISTORY_LIMIT = 20;

function readHistory(): AskAiExchange[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as AskAiExchange[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: AskAiExchange[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // A full or blocked storage must not break asking a question.
  }
}

export default function AskAiPanel({
  open,
  onClose,
  onReportProblem,
}: {
  open: boolean;
  onClose: () => void;
  onReportProblem: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<AskAiExchange[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  function openHistory() {
    setHistory(readHistory());
    setShowHistory((visible) => !visible);
  }

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("Type a question first.");
      return;
    }
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;
      if (!response.ok || !body?.answer) {
        setError(body?.error ?? "The assistant failed to answer.");
        return;
      }
      setAnswer(body.answer);
      const entry: AskAiExchange = {
        question: trimmed,
        answer: body.answer,
        askedAt: new Date().toISOString(),
      };
      const next = [entry, ...readHistory()];
      writeHistory(next);
      setHistory(next.slice(0, HISTORY_LIMIT));
    } finally {
      setAsking(false);
    }
  }

  return (
    <Drawer
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 1 }}>
            HELP
          </Typography.Text>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Ask AI
          </Typography.Title>
        </Space>
      }
      placement="right"
      width={460}
      open={open}
      onClose={onClose}
      destroyOnHidden
      classNames={{ wrapper: "ask-ai-drawer" }}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text strong style={{ letterSpacing: 1, fontSize: 12 }}>
            ASK AI
          </Typography.Text>
          <Space size="middle">
            <Button type="text" size="small" icon={<HistoryOutlined />} onClick={openHistory}>
              History
            </Button>
            <Button type="link" size="small" onClick={onReportProblem}>
              Report a problem
            </Button>
          </Space>
        </Space>

        <Input.TextArea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. Why can't I post to a closed period?"
          rows={4}
          maxLength={ASK_AI_MAX_QUESTION_LENGTH}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />

        <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
          <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 260 }}>
            {ASK_AI_GROUNDING_NOTE}
          </Typography.Text>
          <Button type="primary" loading={asking} onClick={ask}>
            Ask
          </Button>
        </Space>

        {error ? <Alert type="warning" showIcon message={error} /> : null}

        {answer ? (
          <Alert
            type="info"
            message="Answer"
            description={
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                {answer}
              </Typography.Paragraph>
            }
          />
        ) : null}

        {showHistory ? (
          <div>
            <Typography.Text strong>History</Typography.Text>
            {history.length ? (
              <Space direction="vertical" size="small" style={{ width: "100%", marginTop: 8 }}>
                {history.map((entry) => (
                  <Button
                    key={entry.askedAt}
                    block
                    style={{ textAlign: "left", height: "auto", whiteSpace: "normal" }}
                    onClick={() => {
                      setQuestion(entry.question);
                      setAnswer(entry.answer);
                      setShowHistory(false);
                    }}
                  >
                    <Typography.Text>{entry.question}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(entry.askedAt).toLocaleString("en-US")}
                    </Typography.Text>
                  </Button>
                ))}
              </Space>
            ) : (
              <Empty
                description="No questions yet on this device."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
        ) : null}
      </Space>
    </Drawer>
  );
}
