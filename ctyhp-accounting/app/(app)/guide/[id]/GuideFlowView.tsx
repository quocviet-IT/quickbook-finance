"use client";

import { Button, Image as PreviewImage } from "antd";
import { ArrowRightOutlined, WarningOutlined } from "@ant-design/icons";
import PageHeader from "@/components/PageHeader";
import IntentLink from "@/components/IntentLink";
import type { GuideFlow } from "@/lib/domain/system-guide";
import { screenName } from "@/lib/domain/screen-names";
import { plural } from "@/lib/format";

/**
 * One workflow (3.0.17): its steps in order, each naming the control that does
 * it and the screen it is on, with a link to that screen. A reader who came
 * from a screen's Help link is told so, and the steps on that screen are
 * marked; one who came for a single step lands on it (#step-n).
 *
 * The words are the guide's own, unchanged; only where they live is new.
 */
export default function GuideFlowView({
  flow,
  areaTitle,
  from,
}: {
  flow: GuideFlow;
  areaTitle: string;
  /** The screen whose Help link brought the reader here. */
  from: { route: string; screen: string } | null;
}) {
  const start = screenName(flow.route);
  return (
    <div className="guide-page">
      <PageHeader
        title={flow.title}
        description={flow.purpose}
        breadcrumbItems={[{ title: "Guide", href: "/guide" }, { title: areaTitle }, { title: flow.title }]}
        meta={
          <span className="guide-card__meta">
            <span className="guide-chip">{plural(flow.steps.length, "step")}</span>
            <span className="guide-chip">Starts on {start}</span>
          </span>
        }
        // A plain button: this app keeps primary actions out of the page header
        // (tests/unit/button-placement-contract.test.ts).
        actions={<Button href={flow.route}>Open {start}</Button>}
      />

      {from ? (
        <p className="guide-came-from" role="status">
          You came from <strong>{from.screen}</strong>.{" "}
          <IntentLink href={from.route}>Back to {from.screen}</IntentLink>
        </p>
      ) : null}

      <div className="guide-flow">
        <div className="guide-flow__main">
          {flow.cautions?.length ? (
            <section className="system-guide__cautions" aria-label="Before you start">
              <strong>
                <WarningOutlined /> Before you start
              </strong>
              <ul>
                {flow.cautions.map((caution) => (
                  <li key={caution.title}>
                    <strong>{caution.title}</strong>
                    <p className="guide-step__note">{caution.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ol className="guide-steps">
            {flow.steps.map((step, index) => {
              const screen = screenName(step.route ?? flow.route);
              const here = from !== null && (step.route ?? flow.route) === from.route;
              return (
                <li
                  key={`${flow.id}-${index}`}
                  id={`step-${index + 1}`}
                  className={`guide-step${here ? " guide-step--here" : ""}`}
                >
                  <span className="guide-step__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="guide-step__body">
                    <h2 className="guide-step__action">
                      <span className="guide-step__visually-numbered">Step {index + 1}: </span>
                      {step.action}
                    </h2>
                    <div className="guide-step__where">
                      <span className="guide-control">{step.control}</span>
                      <span>on {screen}</span>
                      {here ? <span className="guide-here-tag">You were here</span> : null}
                      {step.route ? (
                        <IntentLink href={step.route} className="guide-route">
                          Open {screen} <ArrowRightOutlined />
                        </IntentLink>
                      ) : null}
                    </div>
                    {step.note ? <p className="guide-step__note">{step.note}</p> : null}
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
              );
            })}
          </ol>
        </div>

        <nav className="guide-rail" aria-label="Steps in this guide">
          <div className="guide-rail__box">
            <strong>On this page</strong>
            {flow.steps.map((step, index) => (
              <a key={`${flow.id}-rail-${index}`} href={`#step-${index + 1}`}>
                <span className="guide-rail__n">{index + 1}</span>
                <span>{step.action}</span>
              </a>
            ))}
          </div>
          <div className="guide-rail__box">
            <strong>Still stuck?</strong>
            <span>Ask AI and Report sit at the bottom right of every screen.</span>
          </div>
        </nav>
      </div>
    </div>
  );
}
