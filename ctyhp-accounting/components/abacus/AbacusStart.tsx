"use client";

import { ArrowRightOutlined, CheckOutlined, StopOutlined } from "@ant-design/icons";
import type { AbacusTopic } from "@/lib/domain/abacus-topics";
import { screenName } from "@/lib/domain/screen-names";
import { formatRecentMoment } from "@/lib/format";
import type { AbacusConversationSummary } from "@/lib/services/abacus-history";
import AbacusMark from "./AbacusMark";
import ScreenIcon from "./ScreenIcon";
import { guideTag, screenArea, topicIcon } from "./abacus-view";
import styles from "./abacus.module.css";

/** The person's conversations as the panel last read them. */
export interface AbacusListState {
  /** Null until the first read comes back. */
  conversations: AbacusConversationSummary[] | null;
  loading: boolean;
  error: string | null;
}

const RECENT_SHOWN = 3;

/**
 * What an empty thread shows (3.0.20): the question for the screen you are on,
 * what Abacus can and cannot answer, common questions by topic, and your
 * three most recent conversations.
 */
export default function AbacusStart({
  pathname,
  topics,
  topicId,
  list,
  timeZone,
  today,
  busy,
  onTopic,
  onAsk,
  onOpen,
  onSeeAll,
  onRetryList,
}: {
  pathname: string;
  topics: readonly AbacusTopic[];
  topicId: string | null;
  list: AbacusListState;
  timeZone: string;
  today: string;
  busy: boolean;
  onTopic: (id: string) => void;
  onAsk: (question: string) => void;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
  onRetryList: () => void;
}) {
  const selected = topics.find((topic) => topic.id === topicId) ?? topics[0] ?? null;
  const conversations = list.conversations;

  return (
    <>
      <div className={styles.hero}>
        <div>
          <p className={styles.hello}>What do you need to do on {screenName(pathname)}?</p>
          <p className={styles.sub}>Ask in your own words. Follow-up questions keep the thread.</p>
        </div>
        <AbacusMark size={52} />
      </div>

      {/* Set like a ledger account: what it can answer on the left, what it cannot see on the right. */}
      <div className={styles.taccount} role="group" aria-label="What Abacus covers">
        <div className={styles.taccountHead} aria-hidden="true">
          <span>Can answer</span>
          <span>Cannot see</span>
        </div>
        <div className={styles.taccountRows}>
          <ul aria-label="Can answer">
            <li>
              <CheckOutlined className={styles.icon} aria-hidden="true" />
              How each screen works
            </li>
            <li>
              <CheckOutlined className={styles.icon} aria-hidden="true" />
              Posting and period rules
            </li>
            <li>
              <CheckOutlined className={styles.icon} aria-hidden="true" />
              Why an action is blocked
            </li>
          </ul>
          <ul aria-label="Cannot see">
            <li>
              <StopOutlined className={styles.icon} aria-hidden="true" />
              Your balances or documents
            </li>
            <li>
              <StopOutlined className={styles.icon} aria-hidden="true" />
              Tax or legal advice
            </li>
          </ul>
        </div>
      </div>

      {selected ? (
        <>
          <p className={styles.label}>Common questions</p>
          <div className={styles.topics} role="group" aria-label="Topics">
            {topics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                className={styles.topic}
                aria-pressed={topic.id === selected.id}
                onClick={() => onTopic(topic.id)}
              >
                <ScreenIcon kind={topicIcon(topic.id, pathname)} className={styles.icon} />
                {topic.label}
              </button>
            ))}
          </div>
          <div className={styles.questions}>
            {selected.questions.map((question) => {
              const tag = guideTag(question);
              return (
                <button
                  key={question.question}
                  type="button"
                  className={styles.question}
                  disabled={busy}
                  title={question.guide ? `Answered by the guide “${question.guide.title}”` : undefined}
                  onClick={() => onAsk(question.question)}
                >
                  <ArrowRightOutlined className={styles.icon} aria-hidden="true" />
                  <span>{question.question}</span>
                  {tag ? (
                    <span className={styles.guideTag} aria-hidden="true">
                      {tag}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {conversations === null && list.loading ? (
        <>
          <p className={styles.label}>Recent conversations</p>
          <div className={styles.recentList} aria-busy="true" aria-label="Loading your recent conversations">
            {[0, 1].map((row) => (
              <div key={row} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.tile} />
                <span className={styles.skeleton} />
              </div>
            ))}
          </div>
        </>
      ) : conversations === null && list.error ? (
        <p className={styles.quietRow}>
          <span>Your recent conversations could not be loaded.</span>
          <button type="button" className={styles.linkButton} onClick={onRetryList}>
            Retry
          </button>
        </p>
      ) : conversations && conversations.length > 0 ? (
        <>
          <div className={styles.labelRow}>
            <p className={styles.label}>Recent conversations</p>
            <button type="button" className={styles.linkButton} onClick={onSeeAll}>
              See all {conversations.length}
            </button>
          </div>
          <div className={styles.recentList}>
            {conversations.slice(0, RECENT_SHOWN).map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={styles.recent}
                onClick={() => onOpen(conversation.id)}
              >
                <ScreenIcon kind={screenArea(conversation.route)} className={styles.tile} />
                <strong className={styles.recentTitle}>{conversation.title}</strong>
                <span className={styles.recentTime}>{formatRecentMoment(conversation.updatedAt, timeZone, today)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
