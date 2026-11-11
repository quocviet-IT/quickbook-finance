"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { ArrowRightOutlined } from "@ant-design/icons";
import { abacusBlocks, type AbacusInline } from "@/lib/domain/abacus-answer";
import ScreenIcon from "./ScreenIcon";
import { screenArea, type AbacusIconKind } from "./abacus-view";
import styles from "./abacus.module.css";

/**
 * An answer drawn as Abacus writes it (3.0.20): paragraphs, numbered steps
 * joined by a line, bullets, a button's name as a key, and the screens it
 * names as links. Only a screen the guide knows becomes a link; any other
 * `[/route]` stays as the text it was. Following a link closes the panel, so
 * the screen it opens is not under it.
 */

function Inlines({ inlines, onNavigate }: { inlines: readonly AbacusInline[]; onNavigate: () => void }) {
  return (
    <>
      {inlines.map((inline, index) => {
        switch (inline.kind) {
          case "control":
            return <kbd key={index}>{inline.text}</kbd>;
          case "strong":
            return <strong key={index}>{inline.text}</strong>;
          case "route":
            return (
              <Link key={index} href={inline.route} className={styles.inlineRoute} onClick={onNavigate}>
                {inline.name}
              </Link>
            );
          default:
            return <Fragment key={index}>{inline.text}</Fragment>;
        }
      })}
    </>
  );
}

/** A screen to open: its icon, its name, where the menu has it, and an arrow. */
export function RouteCard({
  href,
  name,
  path,
  icon,
  onNavigate,
}: {
  href: string;
  name: string;
  path: string;
  icon?: AbacusIconKind;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} className={styles.route} onClick={onNavigate}>
      <ScreenIcon kind={icon ?? screenArea(href)} className={styles.tile} />
      <span className={styles.routeText}>
        <b>{name}</b>
        <small>{path}</small>
      </span>
      <ArrowRightOutlined className={styles.icon} aria-hidden="true" />
    </Link>
  );
}

export function AnswerBlocks({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const blocks = useMemo(() => abacusBlocks(text), [text]);
  return (
    <div className={styles.answerText}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p key={index}>
                <Inlines inlines={block.inlines} onNavigate={onNavigate} />
              </p>
            );
          case "steps":
            return (
              <ol key={index} className={styles.steps}>
                {block.items.map((item, step) => (
                  <li key={step}>
                    <span>
                      <Inlines inlines={item} onNavigate={onNavigate} />
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "bullets":
            return (
              <ul key={index} className={styles.bullets}>
                {block.items.map((item, bullet) => (
                  <li key={bullet}>
                    <Inlines inlines={item} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            );
          case "route":
            return (
              <RouteCard key={index} href={block.route} name={block.name} path={block.path} onNavigate={onNavigate} />
            );
        }
      })}
    </div>
  );
}
