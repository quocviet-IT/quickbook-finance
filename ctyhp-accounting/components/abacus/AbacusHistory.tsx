"use client";

import { Fragment, type Ref } from "react";
import { DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import { screenName } from "@/lib/domain/screen-names";
import { formatTime, plural } from "@/lib/format";
import type { AbacusConversationSummary } from "@/lib/services/abacus-history";
import ScreenIcon from "./ScreenIcon";
import type { AbacusListState } from "./AbacusStart";
import { ABACUS_KEPT, filterConversations, groupByDay, screenArea } from "./abacus-view";
import styles from "./abacus.module.css";

/**
 * Past conversations (3.0.20): the person's own, in the company that is open,
 * newest first and grouped by day on the company's clock. Searched in the
 * browser, since the list is at most twenty. Each opens to the whole thread,
 * and each can be deleted.
 */
export default function AbacusHistory({
  list,
  query,
  searchRef,
  timeZone,
  today,
  onQuery,
  onOpen,
  onDelete,
  onClearAll,
  onRetry,
}: {
  list: AbacusListState;
  query: string;
  searchRef: Ref<HTMLInputElement>;
  timeZone: string;
  today: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  onDelete: (conversation: AbacusConversationSummary) => void;
  onClearAll: (count: number) => void;
  onRetry: () => void;
}) {
  const conversations = list.conversations;
  const found = conversations ? filterConversations(conversations, query) : [];

  let content;
  if (conversations === null && list.error && !list.loading) {
    content = (
      <div className={styles.empty} role="alert">
        <b>Your conversations could not be loaded.</b>
        <span>{list.error}</span>
        <button type="button" className={styles.linkButton} onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  } else if (conversations === null) {
    content = (
      <div className={styles.recentList} aria-busy="true" aria-label="Loading your conversations">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={styles.skeletonRow} aria-hidden="true">
            <span className={styles.tile} />
            <span className={styles.skeleton} />
          </div>
        ))}
      </div>
    );
  } else if (conversations.length === 0) {
    content = (
      <div className={styles.empty}>
        <b>No conversations yet</b>
        <span>Questions you ask are kept here, under your account.</span>
      </div>
    );
  } else if (found.length === 0) {
    content = (
      <div className={styles.empty} role="status">
        <span>No conversation matches “{query.trim()}”.</span>
        <button type="button" className={styles.linkButton} onClick={() => onQuery("")}>
          Clear search
        </button>
      </div>
    );
  } else {
    content = groupByDay(found, timeZone, today).map((group) => (
      <Fragment key={group.heading}>
        <h3 className={styles.day}>{group.heading}</h3>
        <ul className={styles.historyList}>
          {group.items.map((conversation) => (
            <li key={conversation.id} className={styles.historyItem}>
              <button type="button" className={styles.historyRow} onClick={() => onOpen(conversation.id)}>
                <ScreenIcon kind={screenArea(conversation.route)} className={styles.tile} />
                <span className={styles.historyText}>
                  <strong>{conversation.title}</strong>
                  <small>
                    <b>{screenName(conversation.route)}</b> · {plural(conversation.questionCount, "question")}
                    {conversation.questionCount > 1 ? ` · last: ${conversation.lastQuestion}` : null}
                  </small>
                </span>
                <time className={styles.historyTime} dateTime={conversation.updatedAt}>
                  {formatTime(conversation.updatedAt, timeZone)}
                </time>
              </button>
              <button
                type="button"
                className={styles.historyDelete}
                aria-label={`Delete this conversation: ${conversation.title}`}
                title="Delete this conversation"
                onClick={() => onDelete(conversation)}
              >
                <DeleteOutlined aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </Fragment>
    ));
  }

  return (
    <>
      <label className={styles.searchbox}>
        <SearchOutlined className={styles.icon} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label="Search past conversations"
          placeholder="Search past conversations"
          maxLength={200}
        />
      </label>
      {content}
      {conversations && conversations.length > 0 ? (
        <div className={styles.historyFoot}>
          <span>The last {ABACUS_KEPT} conversations are kept.</span>
          <button
            type="button"
            className={`${styles.linkButton} ${styles.danger}`}
            onClick={() => onClearAll(conversations.length)}
          >
            Clear all history
          </button>
        </div>
      ) : null}
    </>
  );
}
