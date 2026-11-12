"use client";

import { Fragment } from "react";
import Link from "next/link";
import {
  BookOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DislikeFilled,
  DislikeOutlined,
  FileTextOutlined,
  LikeFilled,
  LikeOutlined,
} from "@ant-design/icons";
import { formatDayHeading, formatTime, plural } from "@/lib/format";
import AbacusMark from "./AbacusMark";
import { AnswerBlocks, RouteCard } from "./AbacusAnswer";
import { asSentence, type AbacusTurn } from "./abacus-view";
import styles from "./abacus.module.css";

/**
 * The conversation (3.0.20): each question on the right, with who asked and
 * when, and under it what came back. An answer the guides cover is a card with
 * the guide it came from; one they do not cover is an amber note; the hourly
 * limit is an amber note with the guide for this screen; anything else that
 * stopped the answer is a red note with Try again. Days are marked on the
 * company's clock.
 */
export interface AbacusThreadProps {
  turns: readonly AbacusTurn[];
  /** Set when the thread was opened again from History. */
  reopened: { createdAt: string } | null;
  timeZone: string;
  today: string;
  followUps: readonly string[];
  limitGuide: { href: string; name: string; path: string };
  copiedKey: string | null;
  busy: boolean;
  onNavigate: () => void;
  onAsk: (question: string) => void;
  onRetry: (turn: AbacusTurn) => void;
  onReport: () => void;
  onCopy: (turn: AbacusTurn) => void;
  onRate: (turn: AbacusTurn, value: 1 | -1) => void;
}

function AbacusSays({ at, timeZone }: { at: string | null; timeZone: string }) {
  return (
    <div className={styles.who}>
      <AbacusMark size={26} />
      <b>Abacus</b>
      {at ? <span>{formatTime(at, timeZone)}</span> : null}
    </div>
  );
}

function Waiting() {
  return (
    <div className={styles.answer} aria-busy="true">
      <div className={styles.answerText}>
        <div className={styles.reading}>
          <span className={styles.rod} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Reading the guides…
        </div>
        <div className={styles.skeleton} style={{ width: "92%" }} aria-hidden="true" />
        <div className={styles.skeleton} style={{ width: "74%" }} aria-hidden="true" />
      </div>
    </div>
  );
}

function Footer({
  turn,
  newest,
  copied,
  onNavigate,
  onCopy,
  onRate,
}: {
  turn: AbacusTurn;
  newest: boolean;
  copied: boolean;
  onNavigate: () => void;
  onCopy: (turn: AbacusTurn) => void;
  onRate: (turn: AbacusTurn, value: 1 | -1) => void;
}) {
  const source = turn.source;
  const rateable = newest && turn.messageId !== null;
  return (
    <div className={styles.footer}>
      {source ? (
        <>
          <span>Ref.</span>
          {source.kind === "guide" ? (
            <Link href={source.href} className={styles.source} onClick={onNavigate} title="Open this guide">
              <BookOutlined className={styles.icon} aria-hidden="true" />
              <span className={styles.sourceName}>Guide · {source.title}</span>
            </Link>
          ) : (
            <span className={styles.source} title={source.title}>
              <FileTextOutlined className={styles.icon} aria-hidden="true" />
              <span className={styles.sourceName}>Manual · {source.title}</span>
            </span>
          )}
        </>
      ) : null}
      <span className={styles.spacer} />
      <button
        type="button"
        className={styles.iconButton}
        aria-label={copied ? "Copied" : "Copy answer"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => onCopy(turn)}
      >
        {copied ? <CheckOutlined aria-hidden="true" /> : <CopyOutlined aria-hidden="true" />}
      </button>
      {rateable ? (
        <>
          <button
            type="button"
            className={styles.iconButton}
            aria-pressed={turn.rating === 1}
            aria-label="Helpful"
            title="Helpful"
            onClick={() => onRate(turn, 1)}
          >
            {turn.rating === 1 ? <LikeFilled aria-hidden="true" /> : <LikeOutlined aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-pressed={turn.rating === -1}
            aria-label="Not right, report it"
            title="Not right? Report it"
            onClick={() => onRate(turn, -1)}
          >
            {turn.rating === -1 ? <DislikeFilled aria-hidden="true" /> : <DislikeOutlined aria-hidden="true" />}
          </button>
        </>
      ) : turn.rating !== null ? (
        // An earlier answer keeps the rating it was given; only the newest can be rated.
        <span
          className={styles.rated}
          role="img"
          aria-label={turn.rating === 1 ? "You marked this helpful" : "You marked this not right"}
          title={turn.rating === 1 ? "You marked this helpful" : "You marked this not right"}
        >
          {turn.rating === 1 ? <LikeFilled aria-hidden="true" /> : <DislikeFilled aria-hidden="true" />}
        </span>
      ) : null}
    </div>
  );
}

function Reply({
  turn,
  newest,
  props,
}: {
  turn: AbacusTurn;
  newest: boolean;
  props: AbacusThreadProps;
}) {
  const { timeZone, onNavigate } = props;

  if (turn.status === "waiting") {
    return (
      <>
        <AbacusSays at={null} timeZone={timeZone} />
        <Waiting />
      </>
    );
  }

  if (turn.status === "limit") {
    return (
      <>
        <AbacusSays at={null} timeZone={timeZone} />
        <div className={styles.note} role="status">
          <b>Hourly limit reached.</b>
          {turn.error ? <p>{turn.error}</p> : null}
          <p>Meanwhile, the guide has the steps:</p>
          <RouteCard
            href={props.limitGuide.href}
            name={props.limitGuide.name}
            path={props.limitGuide.path}
            icon="guide"
            onNavigate={onNavigate}
          />
        </div>
      </>
    );
  }

  if (turn.status === "failed") {
    return (
      <>
        <AbacusSays at={null} timeZone={timeZone} />
        <div className={`${styles.note} ${styles.noteError}`} role="alert">
          <b>No answer came back.</b>
          <p>{asSentence(turn.error ?? "The connection dropped before the answer arrived.")} Your question is kept.</p>
          <div className={styles.noteRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={props.busy}
              onClick={() => props.onRetry(turn)}
            >
              Try again
            </button>
            <button type="button" className={styles.button} onClick={props.onReport}>
              Report a problem
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AbacusSays at={turn.answeredAt} timeZone={timeZone} />
      {turn.covered ? (
        <div className={styles.answer}>
          <AnswerBlocks text={turn.answer} onNavigate={onNavigate} />
          <Footer
            turn={turn}
            newest={newest}
            copied={props.copiedKey === turn.key}
            onNavigate={onNavigate}
            onCopy={props.onCopy}
            onRate={props.onRate}
          />
        </div>
      ) : (
        <div className={styles.note}>
          <b>The guides don&apos;t cover this.</b>
          <AnswerBlocks text={turn.answer} onNavigate={onNavigate} />
        </div>
      )}
      {turn.saved ? null : <p className={styles.unsaved}>This answer was not saved to your history.</p>}
    </>
  );
}

export default function AbacusThread(props: AbacusThreadProps) {
  const { turns, reopened, timeZone, today, followUps } = props;
  return (
    <>
      {reopened ? (
        <div className={styles.pastBanner}>
          <ClockCircleOutlined className={styles.icon} aria-hidden="true" />
          <span>
            Conversation from{" "}
            <b>
              {formatDayHeading(reopened.createdAt, timeZone, today)} · {formatTime(reopened.createdAt, timeZone)}
            </b>{" "}
            · {plural(turns.length, "question")}
          </span>
        </div>
      ) : null}
      {turns.map((turn, index) => {
        const day = formatDayHeading(turn.askedAt, timeZone, today);
        const newDay = index === 0 || day !== formatDayHeading(turns[index - 1].askedAt, timeZone, today);
        return (
          <Fragment key={turn.key}>
            {newDay ? <div className={styles.separator}>{day}</div> : null}
            <div className={`${styles.who} ${styles.whoYou}`}>You · {formatTime(turn.askedAt, timeZone)}</div>
            <p className={styles.me}>{turn.question}</p>
            <Reply turn={turn} newest={index === turns.length - 1} props={props} />
          </Fragment>
        );
      })}
      {followUps.length > 0 ? (
        <div className={styles.next}>
          <p className={styles.label}>Ask next</p>
          <div className={styles.chips}>
            {followUps.map((question) => (
              <button
                key={question}
                type="button"
                className={styles.chip}
                disabled={props.busy}
                onClick={() => props.onAsk(question)}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
