"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AutoComplete, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { searchKindLabel } from "@/lib/domain/navigation";
import { globalSearchAction, type SearchHit } from "@/app/(app)/search-actions";

/** What the field says it searches, where it has the room to say it. */
export const SEARCH_PLACEHOLDER_LONG = "Search invoices, bills, contacts…";
/** What it says where it does not, rather than "Search invoices, bills, co…". */
export const SEARCH_PLACEHOLDER_SHORT = "Search…";
/**
 * The field's width from which the long hint shows whole: 213px of text, 50px
 * of icon, padding and border, and the 8px Chrome needs to spare before it cuts a
 * placeholder short (2.29). The header gives the field about 200px at 1280 and
 * 233px at 1440, so most screens get the short hint.
 */
export const SEARCH_PLACEHOLDER_LONG_FROM = 272;

/**
 * Top-bar search over document numbers, contacts, and items. Debounced, and the
 * result set is whatever the caller is allowed to see — the RPC runs under RLS.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  // Short until measured: a long hint drawn first and then cut is the fault
  // this avoids; growing to the long one once there is room is not.
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setRoomy(entry.contentRect.width >= SEARCH_PLACEHOLDER_LONG_FROM),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    const currentRequest = ++requestId.current;
    if (next.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const res = await globalSearchAction(next);
      if (currentRequest !== requestId.current) return;
      setLoading(false);
      setHits(res.ok && res.data ? res.data : []);
    }, 250);
  }

  const options = useMemo(
    () =>
      hits.map((hit) => ({
        value: `${hit.kind}:${hit.id}`,
        href: hit.href,
        label: (
          <div className="global-search__option">
            <Typography.Text strong>{hit.label}</Typography.Text>
            <Typography.Text type="secondary" className="global-search__option-meta">
              {searchKindLabel(hit.kind)}
              {hit.sublabel ? ` · ${hit.sublabel}` : ""}
            </Typography.Text>
          </div>
        ),
      })),
    [hits],
  );

  return (
    <div ref={box} className="global-search__box">
      <AutoComplete
        value={value}
        options={options}
        size="large"
        allowClear
        prefix={<SearchOutlined />}
        placeholder={roomy ? SEARCH_PLACEHOLDER_LONG : SEARCH_PLACEHOLDER_SHORT}
        aria-label="Search documents and contacts"
        className="global-search"
        popupMatchSelectWidth
        onChange={onChange}
        onSelect={(_, option) => {
          const href = (option as { href?: string }).href;
          requestId.current++;
          if (timer.current) clearTimeout(timer.current);
          setValue("");
          setHits([]);
          setLoading(false);
          if (href) router.push(href);
        }}
        notFoundContent={
          value.trim().length < 2 ? null : loading ? "Searching…" : "Nothing matched"
        }
      />
    </div>
  );
}
