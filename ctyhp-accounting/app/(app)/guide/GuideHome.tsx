"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Collapse, Empty, Input, Tabs, Tag, Typography } from "antd";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import PageHeader from "@/components/PageHeader";
import IntentLink from "@/components/IntentLink";
import WhatsNewPanel from "@/components/guide/WhatsNewPanel";
import {
  GUIDE_AREAS,
  GUIDE_FLOWS,
  GUIDE_NOTICES,
  GUIDE_VERSION,
  companyNotice,
  type GuideCompany,
  type GuideFlow,
} from "@/lib/domain/system-guide";
import { searchCountLine, searchGuide, searchReleases } from "@/lib/domain/screen-context";
import { guideCardMeta } from "@/lib/domain/guide-help";
import { RELEASES, releasesSince, versionLabel, type Release } from "@/lib/domain/changelog";
import {
  lastReleaseSeen,
  lastReleaseSeenServerSnapshot,
  markReleasesSeen,
  subscribeReleaseNotes,
} from "@/lib/client/release-notes";
import { formatDate, plural } from "@/lib/format";

export type GuideTab = "guides" | "new" | "about";

/** Releases listed before "Show older releases": enough for a month of work. */
const RECENT_RELEASES = 12;

/** For telling the first render in the browser from the server's, which nothing changes. */
const subscribeNothing = () => () => {};

/** One workflow, as a card: its title, what it is for, and how long it is. */
function GuideCard({ flow, from }: { flow: GuideFlow; from?: string }) {
  const href = from ? `/guide/${flow.id}?from=${encodeURIComponent(from)}` : `/guide/${flow.id}`;
  return (
    <IntentLink href={href} className="guide-card">
      <span className="guide-card__title">{flow.title}</span>
      <span className="guide-card__purpose">{flow.purpose}</span>
      <span className="guide-card__meta">
        {guideCardMeta(flow).map((part) => (
          <span key={part} className="guide-chip">
            {part}
          </span>
        ))}
      </span>
    </IntentLink>
  );
}

/** One release, opened by its version, date and headline. */
function ReleaseLabel({ release, unread }: { release: Release; unread: boolean }) {
  return (
    <span className="guide-release">
      <span className="guide-release__head">
        <span className="guide-release__version">{versionLabel(release.version)}</span>
        <span className="guide-release__date">{formatDate(release.date)}</span>
        {unread ? <Tag color="blue">New</Tag> : null}
      </span>
      <span className="guide-release__headline">{release.headline}</span>
    </span>
  );
}

/** The tab, in the address too, so a reader can come back to it or send it on. */
function rememberTab(tab: GuideTab) {
  const url = new URL(window.location.href);
  if (tab === "guides") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

/**
 * The guide's home page (3.0.17): the workflows grouped as the sidebar groups
 * the screens, what changed in each release, and what OneBook is. It opens on
 * the workflows; the drawer it replaced opened on the release notes after
 * every release, so the guide itself was always one click further away.
 *
 * Every workflow links to its own page, and every page names screens the way
 * the menu does — "Starts on Bank Transactions", never "/banking".
 */
export default function GuideHome({
  initialTab,
  from,
  company,
}: {
  initialTab: GuideTab;
  /** The screen a Help link came from, and the guides that cover it. */
  from: { route: string; screen: string; flowIds: string[] } | null;
  /** The company whose books are open. */
  company: GuideCompany | null;
}) {
  const [tab, setTab] = useState<GuideTab>(initialTab);
  const [query, setQuery] = useState("");
  const [showOlder, setShowOlder] = useState(false);

  // What this browser has read, live: it clears the What's new tab's New mark
  // the moment the notes are opened, as the menu's does. The server renders
  // everything as read: it cannot know, and a New mark that flashes on every
  // load teaches people to ignore it.
  const seen = useSyncExternalStore(subscribeReleaseNotes, lastReleaseSeen, lastReleaseSeenServerSnapshot);
  const anyUnread = releasesSince(seen).length > 0;
  // What it had read when this page opened, so the releases being read keep
  // their New marks after opening them has counted them read. Read in the
  // browser only — the server's guess would differ — and shown once mounted.
  const [seenAtOpen] = useState(() => lastReleaseSeen());
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const unreadAtOpen = useMemo(
    () => new Set(mounted ? releasesSince(seenAtOpen).map((release) => release.version) : []),
    [mounted, seenAtOpen],
  );

  // Opening What's new counts its notes read. Safe to repeat — it only ever
  // writes the current version — which matters, as React may run it twice.
  useEffect(() => {
    if (tab === "new") markReleasesSeen();
  }, [tab]);

  const searching = query.trim() !== "";
  // Searching means searching everything: the workflows and the release notes,
  // where a control that moved is found where the move is told.
  const results = useMemo(() => (searching ? searchGuide(query).map((match) => match.flow) : []), [query, searching]);
  const releaseHits = useMemo(() => (searching ? searchReleases(query, RELEASES) : []), [query, searching]);

  const notice = companyNotice(company);
  const fromFlows = from ? from.flowIds.map((id) => GUIDE_FLOWS.find((flow) => flow.id === id)).filter((flow): flow is GuideFlow => Boolean(flow)) : [];
  const releases = showOlder ? RELEASES : RELEASES.slice(0, RECENT_RELEASES);
  const latest = RELEASES[0];

  const changeTab = (next: GuideTab) => {
    setTab(next);
    rememberTab(next);
  };

  const guides = (
    <div className="guide-pane">
      {from ? (
        <section className="guide-from" aria-label={`Guides for ${from.screen}`}>
          <span className="guide-from__title">For the screen you were on: {from.screen}</span>
          {fromFlows.length > 0 ? (
            <div className="guide-cards">
              {fromFlows.map((flow) => (
                <GuideCard key={flow.id} flow={flow} from={from.route} />
              ))}
            </div>
          ) : (
            <span className="guide-from__empty">
              Nothing in the guide covers {from.screen} yet. Every guide is listed below, and Ask Abacus, at the bottom
              right of every screen, can answer about this one.{" "}
              <IntentLink href={from.route}>Back to {from.screen}</IntentLink>
            </span>
          )}
        </section>
      ) : null}
      {GUIDE_AREAS.map((area) => {
        const flows = GUIDE_FLOWS.filter((flow) => flow.area === area.id);
        if (flows.length === 0) return null;
        return (
          <section key={area.id} className="guide-area" aria-labelledby={`guide-area-${area.id}`}>
            <div className="guide-area__head">
              <h2 id={`guide-area-${area.id}`} className="guide-area__title">
                {area.title}
              </h2>
              <span className="guide-area__blurb">
                {plural(flows.length, "guide")} · {area.blurb}
              </span>
            </div>
            <div className="guide-cards">
              {flows.map((flow) => (
                <GuideCard key={flow.id} flow={flow} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );

  const whatsNew = (
    <div className="guide-pane">
      <Typography.Paragraph type="secondary" className="guide-pane__intro">
        Every release, newest first. Open one to see what changed and the screen it changed.
      </Typography.Paragraph>
      <Collapse
        className="guide-releases"
        defaultActiveKey={[latest.version]}
        items={releases.map((release) => ({
          key: release.version,
          label: <ReleaseLabel release={release} unread={unreadAtOpen.has(release.version)} />,
          children: <WhatsNewPanel releases={[release]} showHeading={false} />,
        }))}
      />
      {RELEASES.length > RECENT_RELEASES ? (
        <Typography.Link className="guide-pane__more" onClick={() => setShowOlder((was) => !was)}>
          {showOlder ? "Show only recent releases" : `Show older releases (${RELEASES.length - RECENT_RELEASES} more)`}
        </Typography.Link>
      ) : null}
    </div>
  );

  const about = (
    <div className="guide-pane guide-about">
      {notice ? (
        <section className={`guide-about__card guide-about__card--${notice.tone}`}>
          {notice.tone === "sample" ? <ExperimentOutlined /> : <SafetyCertificateOutlined />}
          <div>
            <Typography.Text strong>{notice.title}</Typography.Text>
            <Typography.Paragraph type="secondary">{notice.body}</Typography.Paragraph>
          </div>
        </section>
      ) : null}
      {GUIDE_NOTICES.map((item) => (
        <section key={item.id} className="guide-about__card">
          <InfoCircleOutlined />
          <div>
            <Typography.Text strong>{item.title}</Typography.Text>
            <Typography.Paragraph type="secondary">{item.body}</Typography.Paragraph>
            {item.id === "status" ? (
              // A plain link: the status page sits outside the signed-in app on purpose.
              <a href="/status" className="guide-route">
                Open the status page <ArrowRightOutlined />
              </a>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <div className="guide-page">
      <PageHeader
        title="Guide"
        description="How to do each job in OneBook, step by step, and what changed in each release."
        meta={
          <span className="guide-version">
            OneBook {versionLabel(GUIDE_VERSION)} · updated {formatDate(latest.date)}
          </span>
        }
      />

      <div className="guide-toolbar">
        <Input
          allowClear
          size="large"
          className="guide-toolbar__search"
          prefix={<SearchOutlined />}
          placeholder="Search the guides and the release notes, or a button name like 'void'"
          aria-label="Search the guides and the release notes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {notice ? (
          <span className={`guide-company guide-company--${notice.tone}`}>
            {notice.tone === "sample" ? <ExperimentOutlined /> : <SafetyCertificateOutlined />}
            <span>{notice.tone === "sample" ? `Sample company: ${company?.name}` : `Live books: ${company?.name}`}</span>
            <Typography.Link onClick={() => changeTab("about")}>What this means</Typography.Link>
          </span>
        ) : null}
      </div>

      {searching ? (
        <div className="guide-pane" role="region" aria-label="Search results">
          <Typography.Text type="secondary" role="status">
            {searchCountLine(results.length, releaseHits.length, query.trim())}
          </Typography.Text>
          {results.length > 0 ? (
            <div className="guide-cards">
              {results.map((flow) => (
                <GuideCard key={flow.id} flow={flow} />
              ))}
            </div>
          ) : releaseHits.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Nothing in the guide mentions “${query.trim()}”.`} />
          ) : null}
          {releaseHits.length > 0 ? (
            <section className="release-notes" aria-label="Release notes that mention the search">
              <Typography.Text strong>
                <NotificationOutlined /> Release notes
              </Typography.Text>
              <WhatsNewPanel releases={releaseHits} />
            </section>
          ) : null}
        </div>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(key) => changeTab(key as GuideTab)}
          className="guide-tabs"
          items={[
            {
              key: "guides",
              label: (
                <span className="guide-tab">
                  <AppstoreOutlined /> Guides <span className="guide-tab__count">{GUIDE_FLOWS.length}</span>
                </span>
              ),
              children: guides,
            },
            {
              key: "new",
              label: (
                <span className="guide-tab">
                  <NotificationOutlined /> What&apos;s new {anyUnread ? <Tag color="blue">New</Tag> : null}
                </span>
              ),
              children: whatsNew,
            },
            {
              key: "about",
              label: (
                <span className="guide-tab">
                  <InfoCircleOutlined /> About OneBook
                </span>
              ),
              children: about,
            },
          ]}
        />
      )}
    </div>
  );
}
