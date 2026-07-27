"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AutoComplete, Input, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { searchKindLabel } from "@/lib/domain/navigation";
import { globalSearchAction, type SearchHit } from "@/app/(app)/search-actions";

/**
 * Top-bar search over document numbers, contacts, and items. Debounced, and the
 * result set is whatever the caller is allowed to see — the RPC runs under RLS.
 */
export default function GlobalSearch() {
  const router = useRouter();
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
    <AutoComplete
      value={value}
      options={options}
      className="global-search"
      popupMatchSelectWidth={360}
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
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search invoices, bills, contacts…"
        aria-label="Search documents and contacts"
      />
    </AutoComplete>
  );
}
