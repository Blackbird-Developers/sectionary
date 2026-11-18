"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BlockViewer } from "@/components/block-viewer";
import { wallSource } from "@/lib/load-blocks";
import type { Block } from "@/lib/blocks";
import type { DetailIndex } from "@/lib/block-detail";
import type { FilterKey } from "@/lib/filters";

/**
 * A block opened where it was clicked (a flow's page, a board), in the block
 * viewer on top, rather than on the wall, which loads the whole library first.
 * The arrows walk the list it came from, Close goes back to where it was, and
 * "See similar" shows the other store's block in place. Only a "Found in" or
 * tech chip leaves for the wall.
 */
export function InlineBlockViewer({
  viewing,
  onViewing,
  onLeave,
}: {
  viewing: { list: Block[]; at: number } | null;
  onViewing: (next: { list: Block[]; at: number } | null) => void;
  /** Called before a chip navigates to the wall, so Back finds the page as it was. */
  onLeave?: () => void;
}) {
  const router = useRouter();
  const [info, setInfo] = useState(false);
  const block = viewing ? (viewing.list[viewing.at] ?? null) : null;

  // Pairs (for the Web / Mobile switch) and similar blocks, as on the wall; the block shows at once meanwhile.
  const [detail, setDetail] = useState<{ id: string; index: DetailIndex } | null>(null);
  useEffect(() => {
    if (!block) return;
    let alive = true;
    wallSource()
      .detail(block.id, block, (partial) => alive && setDetail({ id: block.id, index: partial }))
      .then(
        (d) => alive && setDetail({ id: block.id, index: d.detail }),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [block]);

  const step = useMemo(() => {
    if (!viewing) return {};
    const { list, at } = viewing;
    return {
      prev: at > 0 ? () => onViewing({ list, at: at - 1 }) : undefined,
      next: at < list.length - 1 ? () => onViewing({ list, at: at + 1 }) : undefined,
    };
  }, [viewing, onViewing]);

  const onShow = useCallback((b: Block) => onViewing({ list: [b], at: 0 }), [onViewing]);
  const onFilter = useCallback(
    (key: FilterKey, value: string) => {
      onLeave?.();
      router.push(`/?${key}=${encodeURIComponent(value)}`);
    },
    [onLeave, router],
  );

  return (
    <BlockViewer
      block={block}
      detail={detail?.id === block?.id ? detail?.index : null}
      info={info}
      onInfo={setInfo}
      onClose={() => onViewing(null)}
      onShow={onShow}
      onStep={step}
      onFilter={onFilter}
    />
  );
}
