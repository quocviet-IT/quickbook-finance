"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alert, Button, Drawer, Empty, Input, Space, Tag, Typography } from "antd";
import { HistoryOutlined, ReloadOutlined } from "@ant-design/icons";
import { ASK_AI_GROUNDING_NOTE, ASK_AI_MAX_QUESTION_LENGTH } from "@/lib/ai/ask-prompt";
import {
  screenContextFor,
  splitAnswerRoutes,
  suggestedQuestions,
} from "@/lib/domain/screen-context";

export interface AskAiExchange {
  question: string;
  answer: string;
  askedAt: string;
  /** The screen it was asked from, so history reads back in context. */
  route?: string;
}

/**
 * History is per person and per browser on purpose: a question can quote what
 * someone was working on, and nobody agreed to share that with the rest of the
 * company. It never leaves this device.
 */
const HISTORY_KEY = "one-book.ask-ai.history";
const HISTORY_LIMIT = 20;
/** How many past exchanges are sent back, so a follow-up has something to follow. */
const CONTEXT_EXCHANGES = 3;

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

/** Render an answer, turning the routes it names into links you can follow. */
function Answer({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
      {splitAnswerRoutes(text).map((segment, index) =>
        segment.kind === "route" ? (
          <Link key={index} href={segment.route} onClick={onNavigate}>
            {segment.route}
          </Link>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </Typography.Paragraph>
  );
}

/**
 * The in-app assistant.
 *
 * It now knows three things it did not: which screen the question came from,
 * what that screen is for, and what was already said. Between them they turn
 * "go to the invoices page" — said to somebody already standing on it — into an
 * answer about the control in front of them, and make "why?" a question that
 * can be answered at all.
 */
export default function AskAiPanel({
  open,
  onClose,
  onReportProblem,
}: {
  open: boolean;
  onClose: () => void;
  onReportProblem: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<AskAiExchange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<AskAiExchange[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const screen = screenContextFor(pathname);
  const suggestions = suggestedQuestions(pathname);

  useEffect(() => {
    if (thread.length > 0) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  function openHistory() {
    setHistory(readHistory());
    setShowHistory((visible) => !visible);
  }

  async function ask(raw?: string) {
    const trimmed = (raw ?? question).trim();
    if (!trimmed) {
      setError("Type a question first.");
      return;
    }
    setAsking(true);
    setError(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          route: pathname,
          history: thread
            .slice(-CONTEXT_EXCHANGES)
            .flatMap((exchange) => [
              { role: "user" as const, content: exchange.question },
              { role: "assistant" as const, content: exchange.answer },
            ]),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;
      if (!response.ok || !body?.answer) {
        setError(body?.error ?? "The assistant failed to answer.");
        return;
      }
      const entry: AskAiExchange = {
        question: trimmed,
        answer: body.answer,
        askedAt: new Date().toISOString(),
        route: pathname,
      };
      setThread((current) => [...current, entry]);
      setQuestion("");
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
      width={480}
      open={open}
      onClose={onClose}
      destroyOnHidden
      classNames={{ wrapper: "ask-ai-drawer" }}
      extra={
        <Space size="small">
          {thread.length > 0 ? (
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => setThread([])}>
              New
            </Button>
          ) : null}
          <Button type="text" size="small" icon={<HistoryOutlined />} onClick={openHistory}>
            History
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {/* Say what it is answering about, so nobody has to guess whether it knows. */}
        <Space size={6} wrap>
          <Tag color="blue">{screen.route}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {screen.summary
              ? "Answering about this screen"
              : "No guide chapter covers this screen yet"}
          </Typography.Text>
        </Space>

        {thread.length === 0 && suggestions.length > 0 ? (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Things people ask here
            </Typography.Text>
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                size="small"
                block
                style={{ textAlign: "left", height: "auto", whiteSpace: "normal" }}
                onClick={() => void ask(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </Space>
        ) : null}

        {thread.map((exchange) => (
          <Space key={exchange.askedAt} direction="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text strong>{exchange.question}</Typography.Text>
            <Alert
              type="info"
              description={<Answer text={exchange.answer} onNavigate={onClose} />}
            />
          </Space>
        ))}
        <div ref={endRef} />

        <Input.TextArea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={
            thread.length > 0
              ? "Ask a follow-up — it remembers what was just said"
              : "e.g. Why can't I post to a closed period?"
          }
          rows={3}
          maxLength={ASK_AI_MAX_QUESTION_LENGTH}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />

        <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
          <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 240 }}>
            {ASK_AI_GROUNDING_NOTE}
          </Typography.Text>
          <Space size="small">
            <Button type="link" size="small" onClick={onReportProblem}>
              Report a problem
            </Button>
            <Button type="primary" loading={asking} onClick={() => void ask()}>
              Ask
            </Button>
          </Space>
        </Space>

        {error ? <Alert type="warning" showIcon message={error} /> : null}

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
                      setThread([entry]);
                      setShowHistory(false);
                    }}
                  >
                    <Typography.Text>{entry.question}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {entry.route ? `${entry.route} · ` : ""}
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
