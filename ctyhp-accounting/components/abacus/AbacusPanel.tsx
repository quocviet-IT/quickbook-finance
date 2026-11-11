"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { App, Drawer } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { useCompanyClock } from "@/components/CompanyClock";
import { ASK_AI_GROUNDING_NOTE, ASK_AI_MAX_QUESTION_LENGTH } from "@/lib/ai/ask-prompt";
import { abacusCoveredFromKey, abacusSourceFromKey, type AbacusSource } from "@/lib/domain/abacus-answer";
import { abacusFollowUps, abacusTopics } from "@/lib/domain/abacus-topics";
import { screenName, screenPath } from "@/lib/domain/screen-names";
import { plural } from "@/lib/format";
import type { AbacusConversationSummary, AbacusExchange } from "@/lib/services/abacus-history";
import {
  clearAbacusHistoryAction,
  deleteAbacusConversationAction,
  listAbacusConversationsAction,
  rateAbacusAnswerAction,
  readAbacusConversationAction,
} from "./actions";
import AbacusHistory from "./AbacusHistory";
import AbacusMark from "./AbacusMark";
import AbacusStart, { type AbacusListState } from "./AbacusStart";
import AbacusThread from "./AbacusThread";
import ScreenIcon from "./ScreenIcon";
import {
  guideForScreen,
  knownSource,
  plainAnswer,
  questionCounter,
  screenArea,
  shortTitle,
  type AbacusTurn,
} from "./abacus-view";
import styles from "./abacus.module.css";

/**
 * Abacus, the in-app assistant, named and redrawn in 3.0.20.
 *
 * It answers from the guides, about the screen the question is asked from, and
 * keeps every conversation under the person's account, in the company that is
 * open: the last twenty, to open again, read whole and carry on. The browser
 * holds nothing of it. The server reads the earlier turns of a follow-up from
 * the database by the conversation's id, saves each exchange, and the panel
 * reads the list back through the history actions.
 *
 * Views: the start (an empty thread), the thread, History, and a past
 * conversation, which is the thread opened again with a banner over it.
 */

const DROPPED = "The connection dropped before the answer arrived.";

/** What /api/ask sends back. */
interface AskReply {
  answer?: unknown;
  source?: AbacusSource;
  covered?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  askedAt?: unknown;
  saved?: unknown;
  error?: unknown;
}

type AskOutcome =
  | {
      kind: "answer";
      answer: string;
      source: AbacusSource;
      covered: boolean;
      conversationId: string | null;
      messageId: string | null;
      askedAt: string;
      saved: boolean;
    }
  | { kind: "limit"; error: string }
  | { kind: "failed"; error: string; status: number | null };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/**
 * Put one question to Abacus. Only the question, the screen and the
 * conversation's id are sent: the server reads the earlier turns itself.
 */
async function askAbacus(question: string, route: string, conversationId: string | null): Promise<AskOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, route, conversationId }),
    });
  } catch {
    return { kind: "failed", error: DROPPED, status: null };
  }
  const reply = (await response.json().catch(() => null)) as AskReply | null;
  if (response.status === 429) {
    return { kind: "limit", error: text(reply?.error) ?? "Try again a little later." };
  }
  const answer = text(reply?.answer);
  if (!response.ok || !reply || answer === null) {
    return { kind: "failed", error: text(reply?.error) ?? DROPPED, status: response.status };
  }
  return {
    kind: "answer",
    answer,
    source: knownSource(reply.source),
    covered: reply.covered !== false,
    conversationId: text(reply.conversationId),
    messageId: text(reply.messageId),
    askedAt: text(reply.askedAt) ?? new Date().toISOString(),
    saved: reply.saved === true,
  };
}

function turnFromExchange(exchange: AbacusExchange): AbacusTurn {
  return {
    key: exchange.id,
    question: exchange.question,
    route: exchange.route,
    askedAt: exchange.askedAt,
    status: "answered",
    answer: exchange.answer,
    source: abacusSourceFromKey(exchange.sourceKey),
    covered: abacusCoveredFromKey(exchange.sourceKey),
    messageId: exchange.id,
    saved: true,
    rating: exchange.rating,
    answeredAt: exchange.askedAt,
    error: null,
  };
}

/** The list after a read: the new list, or the one before with what went wrong. */
function listAfter(
  current: AbacusListState,
  result: Awaited<ReturnType<typeof listAbacusConversationsAction>>,
): AbacusListState {
  return result.ok
    ? { conversations: result.conversations, loading: false, error: null }
    : { conversations: current.conversations, loading: false, error: result.error };
}

interface Reopened {
  id: string;
  route: string;
  createdAt: string;
}

type Opening = { id: string; status: "loading" } | { id: string; status: "error"; error: string };

export default function AbacusPanel({
  open,
  onClose,
  onReportProblem,
}: {
  open: boolean;
  onClose: () => void;
  onReportProblem: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const { timeZone, today } = useCompanyClock();
  const { message, modal } = App.useApp();
  const titleId = useId();

  const [view, setView] = useState<"chat" | "history">("chat");
  const [thread, setThread] = useState<AbacusTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [reopened, setReopened] = useState<Reopened | null>(null);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [draft, setDraft] = useState("");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [list, setList] = useState<AbacusListState>({ conversations: null, loading: true, error: null });

  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Bumped by New and by opening a past conversation, so an answer still on its way lands nowhere. */
  const generation = useRef(0);
  const nextKey = useRef(0);
  /** Where the thread scrolls once the next change is drawn. */
  const scrollTo = useRef<"top" | "bottom" | null>(null);

  const topics = useMemo(() => abacusTopics(pathname), [pathname]);
  const busy = thread.some((turn) => turn.status === "waiting");
  const last = thread[thread.length - 1];
  const followUps = useMemo(
    () =>
      last && last.status === "answered" && !busy
        ? abacusFollowUps(
            last.route,
            thread.map((turn) => turn.question),
          )
        : [],
    [last, busy, thread],
  );
  const limitGuide = useMemo(() => guideForScreen(pathname), [pathname]);

  const refreshList = useCallback(async () => {
    const result = await listAbacusConversationsAction();
    setList((current) => listAfter(current, result));
  }, []);

  // Each time the panel opens, read the list again: another tab may have asked.
  useEffect(() => {
    if (!open) return;
    let current = true;
    void listAbacusConversationsAction().then((result) => {
      if (current) setList((state) => listAfter(state, result));
    });
    return () => {
      current = false;
    };
  }, [open]);

  useEffect(() => {
    const body = bodyRef.current;
    const target = scrollTo.current;
    scrollTo.current = null;
    if (!body || !target) return;
    body.scrollTop = target === "top" ? 0 : body.scrollHeight;
  }, [thread, view, opening]);

  useEffect(() => {
    if (view === "history") searchRef.current?.focus();
  }, [view]);

  function patchTurn(key: string, patch: Partial<AbacusTurn>) {
    setThread((current) => current.map((turn) => (turn.key === key ? { ...turn, ...patch } : turn)));
  }

  function retryList() {
    setList((current) => ({ ...current, loading: true, error: null }));
    void refreshList();
  }

  function startNew() {
    generation.current += 1;
    scrollTo.current = "top";
    setThread([]);
    setConversationId(null);
    setReopened(null);
    setOpening(null);
    setView("chat");
    textareaRef.current?.focus();
  }

  function showHistory() {
    if (view === "history") {
      setView("chat");
      return;
    }
    setQuery("");
    setView("history");
    if (list.conversations === null) setList((current) => ({ ...current, loading: true, error: null }));
    void refreshList();
  }

  async function openConversation(id: string) {
    generation.current += 1;
    const mine = generation.current;
    scrollTo.current = "top";
    setView("chat");
    setThread([]);
    setConversationId(null);
    setReopened(null);
    setOpening({ id, status: "loading" });
    const result = await readAbacusConversationAction(id);
    if (mine !== generation.current) return;
    if (!result.ok) {
      setOpening({ id, status: "error", error: result.error });
      return;
    }
    const conversation = result.conversation;
    scrollTo.current = "top";
    setThread(conversation.exchanges.map(turnFromExchange));
    setConversationId(conversation.id);
    setReopened({ id: conversation.id, route: conversation.route, createdAt: conversation.createdAt });
    setOpening(null);
  }

  async function send(raw: string, retry?: AbacusTurn) {
    const question = raw.trim();
    if (!question || busy || opening?.status === "loading") return;
    if (question.length > ASK_AI_MAX_QUESTION_LENGTH) return;
    const mine = generation.current;
    const key = retry?.key ?? `ask-${(nextKey.current += 1)}`;
    const route = retry?.route ?? pathname;
    const waiting: AbacusTurn = {
      key,
      question,
      route,
      askedAt: retry?.askedAt ?? new Date().toISOString(),
      status: "waiting",
      answer: "",
      source: null,
      covered: true,
      messageId: null,
      saved: false,
      rating: null,
      answeredAt: null,
      error: null,
    };
    scrollTo.current = "bottom";
    setView("chat");
    setThread((current) => (retry ? current.map((turn) => (turn.key === key ? waiting : turn)) : [...current, waiting]));
    setDraft((current) => (current.trim() === question ? "" : current));

    const outcome = await askAbacus(question, route, conversationId);
    if (mine !== generation.current) {
      // Started over while it was on its way: the server kept it, the list shows it.
      void refreshList();
      return;
    }
    scrollTo.current = "bottom";
    if (outcome.kind === "answer") {
      if (outcome.conversationId) setConversationId(outcome.conversationId);
      patchTurn(key, {
        status: "answered",
        answer: outcome.answer,
        source: outcome.source,
        covered: outcome.covered,
        messageId: outcome.saved ? outcome.messageId : null,
        saved: outcome.saved,
        answeredAt: outcome.askedAt,
      });
      void refreshList();
      return;
    }
    if (outcome.kind === "failed" && outcome.status === 404) {
      // The conversation was deleted elsewhere: Try again starts a new one.
      setConversationId(null);
      setReopened(null);
    }
    patchTurn(key, { status: outcome.kind, error: outcome.error });
    // The question stays in the thread, and in the box to edit or send again.
    setDraft((current) => (current.trim() === "" ? question : current));
  }

  async function copy(turn: AbacusTurn) {
    try {
      await navigator.clipboard.writeText(plainAnswer(turn.answer));
      setCopiedKey(turn.key);
      window.setTimeout(() => setCopiedKey((current) => (current === turn.key ? null : current)), 1200);
    } catch {
      message.error("The answer could not be copied. Select the text and copy it instead.");
    }
  }

  async function rate(turn: AbacusTurn, value: 1 | -1) {
    if (!turn.messageId) return;
    const previous = turn.rating;
    const next = previous === value ? null : value;
    patchTurn(turn.key, { rating: next });
    const result = await rateAbacusAnswerAction(turn.messageId, next);
    if (!result.ok) {
      patchTurn(turn.key, { rating: previous });
      message.error(result.error);
    }
    // Not right: say what was wrong, with the page behind the panel in the screenshot.
    if (next === -1) onReportProblem();
  }

  function confirmDelete(conversation: AbacusConversationSummary) {
    modal.confirm({
      title: `Delete "${shortTitle(conversation.title)}"?`,
      content: "Its questions and answers leave your history. This cannot be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Keep it",
      autoFocusButton: "cancel",
      onOk: async () => {
        const result = await deleteAbacusConversationAction(conversation.id);
        if (!result.ok) {
          message.error(result.error);
          return;
        }
        setList((current) => ({
          ...current,
          conversations: current.conversations?.filter((item) => item.id !== conversation.id) ?? null,
        }));
        if (conversationId === conversation.id) {
          generation.current += 1;
          setThread([]);
          setConversationId(null);
          setReopened(null);
        }
        message.success("Conversation deleted");
      },
    });
  }

  function confirmClearAll(count: number) {
    modal.confirm({
      title: count === 1 ? "Delete your only conversation?" : `Delete all ${plural(count, "conversation")}?`,
      content: "This cannot be undone.",
      okText: "Delete all",
      okButtonProps: { danger: true },
      cancelText: "Keep them",
      autoFocusButton: "cancel",
      onOk: async () => {
        const result = await clearAbacusHistoryAction();
        if (!result.ok) {
          message.error(result.error);
          return;
        }
        setList({ conversations: [], loading: false, error: null });
        if (conversationId !== null) {
          generation.current += 1;
          setThread([]);
          setConversationId(null);
          setReopened(null);
        }
        message.success(`Deleted ${plural(result.deleted, "conversation")}`);
      },
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line. A keyboard still composing a
    // word (Vietnamese Telex, Japanese) uses Enter to finish it.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  }

  const loadingPast = opening?.status === "loading";
  const canSend = draft.trim() !== "" && !busy && !loadingPast;
  const placeholder =
    reopened || opening
      ? "Continue this conversation…"
      : thread.length === 0
        ? "Ask how something works, e.g. Why can't I void this invoice?"
        : "Ask a follow-up…";

  let context = null;
  if (view === "history") {
    context = (
      <div className={styles.context}>
        <button type="button" className={styles.linkButton} onClick={() => setView("chat")}>
          <ArrowLeftOutlined aria-hidden="true" /> Back to chat
        </button>
        <span className={styles.spacer} />
        {list.conversations ? <span>{plural(list.conversations.length, "conversation")}</span> : null}
      </div>
    );
  } else if (reopened || opening) {
    context = (
      <div className={styles.context}>
        <button type="button" className={styles.linkButton} onClick={showHistory} aria-label="Back to history">
          <ArrowLeftOutlined aria-hidden="true" /> History
        </button>
        <span className={styles.spacer} />
        {reopened ? (
          <span>
            Asked on <b>{screenName(reopened.route)}</b>
          </span>
        ) : null}
      </div>
    );
  }

  let body;
  if (view === "history") {
    body = (
      <div ref={bodyRef} className={styles.body}>
        <AbacusHistory
          list={list}
          query={query}
          searchRef={searchRef}
          timeZone={timeZone}
          today={today}
          onQuery={setQuery}
          onOpen={(id) => void openConversation(id)}
          onDelete={confirmDelete}
          onClearAll={confirmClearAll}
          onRetry={retryList}
        />
      </div>
    );
  } else {
    body = (
      <div ref={bodyRef} className={styles.body}>
        {opening?.status === "loading" ? (
          <div className={styles.pastBanner} aria-busy="true">
            Opening the conversation…
          </div>
        ) : opening?.status === "error" ? (
          <div className={`${styles.note} ${styles.noteError}`} role="alert" style={{ marginLeft: 0 }}>
            <b>This conversation could not be opened.</b>
            <p>{opening.error}</p>
            <div className={styles.noteRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={() => void openConversation(opening.id)}
              >
                Try again
              </button>
              <button type="button" className={styles.button} onClick={showHistory}>
                Back to history
              </button>
            </div>
          </div>
        ) : thread.length === 0 ? (
          <AbacusStart
            pathname={pathname}
            topics={topics}
            topicId={topicId}
            list={list}
            timeZone={timeZone}
            today={today}
            busy={busy}
            onTopic={setTopicId}
            onAsk={(question) => void send(question)}
            onOpen={(id) => void openConversation(id)}
            onSeeAll={showHistory}
            onRetryList={retryList}
          />
        ) : null}
        {/* The conversation is a log: what is added to it is read out, politely. */}
        <div className={styles.thread} role="log" aria-live="polite" aria-label="Conversation with Abacus">
          {thread.length > 0 ? (
            <AbacusThread
              turns={thread}
              reopened={reopened}
              timeZone={timeZone}
              today={today}
              followUps={followUps}
              limitGuide={limitGuide}
              copiedKey={copiedKey}
              busy={busy}
              onNavigate={onClose}
              onAsk={(question) => void send(question)}
              onRetry={(turn) => void send(turn.question, turn)}
              onReport={onReportProblem}
              onCopy={(turn) => void copy(turn)}
              onRate={(turn, value) => void rate(turn, value)}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Drawer
      title={null}
      closable={false}
      placement="right"
      size={468}
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      classNames={{ wrapper: "abacus-drawer" }}
      styles={{
        wrapper: { maxWidth: "100vw" },
        body: { padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
      }}
      afterOpenChange={(visible) => {
        if (visible && view === "chat") textareaRef.current?.focus();
      }}
    >
      <section className={styles.panel}>
        <header className={styles.header}>
          <AbacusMark size={40} />
          <div className={styles.headerText}>
            <h2 className={styles.title} id={titleId}>
              Abacus
            </h2>
            <p className={styles.subtitle}>Answers from the guides</p>
          </div>
          <button
            type="button"
            className={styles.headerButton}
            onClick={startNew}
            aria-label="New conversation"
            title="Start a new conversation"
          >
            <PlusOutlined aria-hidden="true" />
            <span className={styles.headerLabel}>New</span>
          </button>
          <button
            type="button"
            className={styles.headerButton}
            onClick={showHistory}
            aria-pressed={view === "history"}
            aria-label="History"
            title="Past conversations"
          >
            <HistoryOutlined aria-hidden="true" />
            <span className={styles.headerLabel}>History</span>
          </button>
          <button type="button" className={styles.headerButton} onClick={onClose} aria-label="Close" title="Close">
            <CloseOutlined aria-hidden="true" />
          </button>
        </header>

        {context}
        {body}

        {view === "chat" ? (
          <div className={styles.composer}>
            <div className={styles.box}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                maxLength={ASK_AI_MAX_QUESTION_LENGTH}
                placeholder={placeholder}
                aria-label="Your question"
                rows={2}
              />
              <div className={styles.tools}>
                <span className={styles.about} title={screenPath(pathname)}>
                  <ScreenIcon kind={screenArea(pathname)} className={styles.icon} />
                  <span className={styles.aboutText}>
                    About <b>{screenName(pathname)}</b>
                  </span>
                </span>
                <span className={styles.spacer} />
                <span className={styles.counter}>{questionCounter(draft.length, ASK_AI_MAX_QUESTION_LENGTH)}</span>
                <button
                  type="button"
                  className={styles.send}
                  onClick={() => void send(draft)}
                  disabled={!canSend}
                  aria-label="Send question"
                  title="Send"
                >
                  <ArrowRightOutlined aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.foot}>
              <span>{ASK_AI_GROUNDING_NOTE}</span>
              <span className={styles.enterHint}>
                <kbd>Enter</kbd> to send
              </span>
            </div>
          </div>
        ) : null}
      </section>
    </Drawer>
  );
}
