"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Collapse, Drawer, Empty, Image as PreviewImage, Input, Tabs, Tag, Typography } from "antd";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  AimOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  GUIDE_AREAS,
  GUIDE_FLOWS,
  GUIDE_NOTICES,
  GUIDE_VERSION,
  companyNotice,
  type GuideCompany,
  type GuideFlow,
} from "@/lib/domain/system-guide";
import { screenContextFor, searchCountLine, searchGuide, searchReleases } from "@/lib/domain/screen-context";
import { RELEASES, releasesSince, type Release } from "@/lib/domain/changelog";
import { lastReleaseSeen, markReleasesSeen } from "@/lib/client/release-notes";
import { formatDate, plural } from "@/lib/format";
import WhatsNewPanel from "./WhatsNewPanel";

/** Releases listed before "Show older releases": enough for a month of work. */
const RECENT_RELEASES = 12;

type GuideTab = "here" | "workflows" | "new" | "about";

/** The steps of one workflow: numbered, joined by a line, each naming its control and where it lives. */
function FlowBody({
  flow,
  onNavigate,
  here,
}: {
  flow: GuideFlow;
  onNavigate: () => void;
  /** The screen the reader is actually on, so a step can say "you are here". */
  here?: string;
}) {
  return (
    <div className="guide-flow__body">
      {flow.cautions?.length ? (
        <section className="system-guide__cautions">
          <Typography.Text strong>
            <WarningOutlined /> Before you start
          </Typography.Text>
          <ul>
            {flow.cautions.map((caution) => (
              <li key={caution.title}>
                <Typography.Text strong>{caution.title}</Typography.Text>
                <Typography.Paragraph type="secondary" className="guide-steps__note">
                  {caution.body}
                </Typography.Paragraph>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ol className="guide-steps">
        {flow.steps.map((step, index) => (
          <li key={`${flow.id}-${index}`} className="guide-steps__step">
            <span className="guide-steps__number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="guide-steps__content">
              <Typography.Text strong>{step.action}</Typography.Text>
              <div className="guide-steps__control">
                <span className="guide-control">{step.control}</span>
                {step.route ? (
                  step.route === here ? (
                    <Tag color="green">You are here</Tag>
                  ) : (
                    <Link href={step.route} onClick={onNavigate} className="guide-route">
                      {step.route} <ArrowRightOutlined />
                    </Link>
                  )
                ) : (
                  <Typography.Text type="secondary">on this screen</Typography.Text>
                )}
              </div>
              {step.note ? (
                <Typography.Paragraph type="secondary" className="guide-steps__note">
                  {step.note}
                </Typography.Paragraph>
              ) : null}
              {step.screenshot ? (
                <figure className="system-guide__shot">
                  {/* Captured from a sample company, never from real books. */}
                  <PreviewImage
                    src={step.screenshot.src}
                    alt={step.screenshot.alt}
                    width="100%"
                    preview={{ mask: "Enlarge" }}
                  />
                  {step.screenshot.caption ? <figcaption>{step.screenshot.caption}</figcaption> : null}
                </figure>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The heading a workflow is opened by: its title, what it is for, and how long it is. */
function FlowLabel({ flow, here }: { flow: GuideFlow; here: string }) {
  return (
    <div className="guide-flow__label">
      <div className="guide-flow__title">
        <Typography.Text strong>{flow.title}</Typography.Text>
        {flow.route === here ? <Tag color="green">Starts here</Tag> : null}
      </div>
      <Typography.Text type="secondary" className="guide-flow__purpose">
        {flow.purpose}
      </Typography.Text>
      <span className="guide-flow__meta">
        {plural(flow.steps.length, "step")}
        {flow.cautions?.length ? " · read before you start" : ""} · starts at {flow.route}
      </span>
    </div>
  );
}

function FlowList({
  flows,
  here,
  onNavigate,
  openSingle = false,
}: {
  flows: GuideFlow[];
  here: string;
  onNavigate: () => void;
  /**
   * Open the workflow when it is the only one: a search that found one thing, or
   * a screen one workflow covers. Not an area that happens to hold one, which
   * would stand open among closed ones for no reason the reader can see.
   */
  openSingle?: boolean;
}) {
  return (
    <Collapse
      accordion
      className="guide-flows"
      defaultActiveKey={openSingle && flows.length === 1 ? [flows[0].id] : []}
      items={flows.map((flow) => ({
        key: flow.id,
        label: <FlowLabel flow={flow} here={here} />,
        children: <FlowBody flow={flow} onNavigate={onNavigate} here={here} />,
      }))}
    />
  );
}

/**
 * A tab's label with its count beside it. On a phone the four full labels do
 * not fit one row and the tab bar hides some behind "…", so a shorter word
 * stands in below 480px (globals.css).
 */
function TabLabel({
  icon,
  text,
  short,
  count,
  dot,
}: {
  icon: ReactNode;
  text: string;
  short?: string;
  count?: number;
  dot?: boolean;
}) {
  return (
    <span className="guide-tab">
      {icon}{" "}
      <span className={short ? "guide-tab__text guide-tab__text--long" : "guide-tab__text"}>{text}</span>
      {short ? <span className="guide-tab__short">{short}</span> : null}
      {count !== undefined ? <span className="guide-tab__count">{count}</span> : null}
      {dot ? <Badge status="processing" className="guide-tab__dot" /> : null}
    </span>
  );
}

/** One release, opened by its version, date and headline. */
function ReleaseLabel({ release, unread }: { release: Release; unread: boolean }) {
  return (
    <div className="guide-release">
      <div className="guide-release__head">
        <span className="guide-release__version">Version {release.version}</span>
        <Typography.Text type="secondary">{formatDate(release.date)}</Typography.Text>
        {unread ? <Tag color="blue">New</Tag> : null}
      </div>
      <Typography.Text className="guide-release__headline">{release.headline}</Typography.Text>
    </div>
  );
}

/**
 * The system guide: what each workflow is for, which control performs each step,
 * and a link to the page it lives on (redesigned in 2.51).
 *
 * Four tabs: the screen the reader is on, every workflow grouped as the sidebar
 * groups the screens, what changed in each release, and about OneBook. A search
 * looks through all of them at once. The open company's kind is said at the top,
 * because "try anything" is right for a sample company and wrong for live books.
 *
 * Every flow links to the live interface rather than describing it, because a
 * named control plus a route survives a layout change. The import flow carries
 * pictures, captured from the running application by
 * `scripts/capture-guide-shots.mjs`, which refuses any company not marked as a
 * sample, so no screenshot can carry a customer's balances.
 */
export default function SystemGuideDrawer({
  open,
  onClose,
  company,
}: {
  open: boolean;
  onClose: () => void;
  /** The company whose books are open, or null where none is (sign-in, the company list). */
  company: GuideCompany | null;
}) {
  const pathname = usePathname() ?? "/";
  const [query, setQuery] = useState("");
  const [showOlder, setShowOlder] = useState(false);

  // What was unread when this drawer opened, captured once.
  //
  // The list must not be live. Opening the drawer is what marks the notes read,
  // and a live list would empty itself in the same tick. The drawer is destroyed
  // when hidden, so this is recomputed on every open, which is exactly the intent.
  const [unread] = useState(() => releasesSince(lastReleaseSeen()));
  const unreadVersions = useMemo(() => new Set(unread.map((release) => release.version)), [unread]);

  useEffect(() => {
    if (open && unread.length > 0) markReleasesSeen();
  }, [open, unread.length]);

  const screen = useMemo(() => screenContextFor(pathname), [pathname]);
  const relevant = useMemo(
    () => [...screen.flowsStartingHere, ...screen.flowsPassingThrough.map((entry) => entry.flow)],
    [screen],
  );
  // Unread release notes first; otherwise the screen the reader is on, or every
  // workflow where nothing in the guide covers this screen.
  const [tab, setTab] = useState<GuideTab>(() =>
    unread.length > 0 ? "new" : relevant.length > 0 ? "here" : "workflows",
  );

  // Searching means searching everything; nobody types a term expecting it to
  // be filtered by which tab they happen to be on.
  const searching = query.trim() !== "";
  const results = useMemo(() => (searching ? searchGuide(query).map((match) => match.flow) : []), [query, searching]);
  // The release notes too: a control that moved is found where the move is told.
  const releaseHits = useMemo(() => (searching ? searchReleases(query, RELEASES) : []), [query, searching]);

  const notice = companyNotice(company);
  const releases = showOlder ? RELEASES : RELEASES.slice(0, RECENT_RELEASES);
  const latest = RELEASES[0];

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
          label: <ReleaseLabel release={release} unread={unreadVersions.has(release.version)} />,
          children: <WhatsNewPanel releases={[release]} onNavigate={onClose} showHeading={false} />,
        }))}
      />
      {RELEASES.length > RECENT_RELEASES ? (
        <Typography.Link className="guide-pane__more" onClick={() => setShowOlder((was) => !was)}>
          {showOlder ? "Show only recent releases" : `Show older releases (${RELEASES.length - RECENT_RELEASES} more)`}
        </Typography.Link>
      ) : null}
    </div>
  );

  const thisScreen = (
    <div className="guide-pane">
      <section className="guide-here">
        <span className="guide-here__kicker">
          <AimOutlined /> You are on
        </span>
        <code className="guide-here__route">{screen.route}</code>
        <Typography.Paragraph className="guide-here__summary">
          {screen.summary ?? "No workflow in the guide starts or passes through this screen yet."}
        </Typography.Paragraph>
      </section>
      {relevant.length > 0 ? (
        <FlowList flows={relevant} here={screen.route} onNavigate={onClose} openSingle />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing here yet.">
          <Typography.Link onClick={() => setTab("workflows")}>See every workflow</Typography.Link>
        </Empty>
      )}
    </div>
  );

  const workflows = (
    <div className="guide-pane">
      {GUIDE_AREAS.map((area) => {
        const flows = GUIDE_FLOWS.filter((flow) => flow.area === area.id);
        if (flows.length === 0) return null;
        return (
          <section key={area.id} className="guide-area" aria-label={area.title}>
            <div className="guide-area__head">
              <span className="guide-area__title">{area.title}</span>
              <span className="guide-area__count">{plural(flows.length, "workflow")}</span>
            </div>
            <Typography.Text type="secondary" className="guide-area__blurb">
              {area.blurb}
            </Typography.Text>
            <FlowList flows={flows} here={screen.route} onNavigate={onClose} />
          </section>
        );
      })}
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
              // A plain link: /status sits outside the signed-in app on purpose.
              <a href="/status" className="guide-route">
                Open /status <ArrowRightOutlined />
              </a>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <Drawer
      title={
        <div className="guide-title">
          <span className="guide-title__name">System guide</span>
          <span className="guide-title__version">
            OneBook {GUIDE_VERSION} · updated {formatDate(latest.date)}
          </span>
        </div>
      }
      open={open}
      onClose={onClose}
      width="min(720px, 100vw)"
      destroyOnHidden
      className="guide-drawer"
    >
      <div className="guide-top">
        {notice ? (
          <div className={`guide-company guide-company--${notice.tone}`}>
            {notice.tone === "sample" ? <ExperimentOutlined /> : <SafetyCertificateOutlined />}
            <span>{notice.tone === "sample" ? `Sample company: ${company?.name}` : `Live books: ${company?.name}`}</span>
            <Typography.Link onClick={() => setTab("about")} className="guide-company__more">
              What this means
            </Typography.Link>
          </div>
        ) : null}
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined />}
          placeholder="Search the guide and the release notes, try a button name like 'void'"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {searching ? (
        <div className="guide-pane">
          <Typography.Text type="secondary">{searchCountLine(results.length, releaseHits.length, query.trim())}</Typography.Text>
          {results.length > 0 ? (
            <FlowList flows={results} here={screen.route} onNavigate={onClose} openSingle />
          ) : releaseHits.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Nothing in the guide mentions “${query.trim()}”.`} />
          ) : null}
          {releaseHits.length > 0 ? (
            <section className="release-notes" aria-label="Release notes that mention the search">
              <Typography.Text strong>
                <NotificationOutlined /> Release notes
              </Typography.Text>
              <WhatsNewPanel releases={releaseHits} onNavigate={onClose} />
            </section>
          ) : null}
        </div>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as GuideTab)}
          className="guide-tabs"
          items={[
            {
              key: "here",
              label: <TabLabel icon={<AimOutlined />} text="This screen" short="Screen" count={relevant.length} />,
              children: thisScreen,
            },
            {
              key: "workflows",
              label: <TabLabel icon={<AppstoreOutlined />} text="Workflows" count={GUIDE_FLOWS.length} />,
              children: workflows,
            },
            {
              key: "new",
              label: <TabLabel icon={<NotificationOutlined />} text="What's new" short="New" dot={unread.length > 0} />,
              children: whatsNew,
            },
            {
              key: "about",
              label: <TabLabel icon={<InfoCircleOutlined />} text="About OneBook" short="About" />,
              children: about,
            },
          ]}
        />
      )}
    </Drawer>
  );
}
