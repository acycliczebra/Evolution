import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { linkHorizontal } from "d3-shape";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import type { Brief, Taxon } from "../types";
import { getTaxon } from "../data";
import { fmtInt, isItalic } from "../taxa";
import { useApp } from "../context";

const MAX_KIDS = 40;

interface TNode extends Brief {
  more?: number;
  children?: TNode[];
}

interface Expansion { open: boolean; kids?: Brief[] }

/** Expandable horizontal tree rooted at the current taxon; click a dot to expand, a label to open. */
export function TreeView({ root, keep }: { root: Taxon; keep: (b: Brief) => boolean }) {
  const { go } = useApp();
  const svgRef = useRef<SVGSVGElement>(null);
  const [exp, setExp] = useState<Map<number, Expansion>>(() => new Map());
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);

  useEffect(() => { setExp(new Map()); }, [root.i]);

  useEffect(() => {
    const z = zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 3]).on("zoom", e => setTransform(e.transform));
    const sel = select(svgRef.current!);
    sel.call(z);
    sel.call(z.transform, zoomIdentity);
    return () => { sel.on(".zoom", null); };
  }, [root.i]);

  const data = useMemo(() => {
    const build = (b: Brief, kids: Brief[] | undefined, open: boolean): TNode => {
      const node: TNode = { ...b };
      if (open && kids) {
        const shown = kids.filter(keep);
        node.children = shown.slice(0, MAX_KIDS).map(k => {
          const e = exp.get(k.i);
          return build(k, e?.kids, !!e?.open);
        });
        if (shown.length > MAX_KIDS) node.children.push({ i: -1 - b.i, n: `+${shown.length - MAX_KIDS} more`, more: shown.length - MAX_KIDS });
      }
      return node;
    };
    return build(root, root.k, true);
  }, [root, exp, keep]);

  const toggle = async (d: TNode) => {
    if (d.more || d.i === root.i) return;
    const cur = exp.get(d.i);
    let kids = cur?.kids;
    if (!kids) kids = (await getTaxon(d.i))?.k ?? [];
    setExp(m => new Map(m).set(d.i, { kids, open: !cur?.open }));
  };

  const laid = tree<TNode>().nodeSize([26, 230])(hierarchy(data));
  const nodes = laid.descendants();
  const minX = Math.min(...nodes.map(d => d.x));
  const off = 30 - minX;
  const H = Math.min(Math.max(520, laid.leaves().length * 26) + 40, 900);
  const link = linkHorizontal<{ source: HierarchyPointNode<TNode>; target: HierarchyPointNode<TNode> }, HierarchyPointNode<TNode>>()
    .x(d => d.y + 60)
    .y(d => d.x + off);

  return (
    <div className="treeview">
      <svg ref={svgRef} width="100%" height={H}>
        <g transform={transform.toString()}>
          <g>
            {laid.links().map(l => <path key={`${l.source.data.i}-${l.target.data.i}`} className="link" d={link(l) ?? undefined} />)}
          </g>
          <g>
            {nodes.map(d => {
              const n = d.data;
              const r = n.more ? 3 : 4 + Math.min(8, Math.log10((n.t || 0) + 1) * 2);
              return (
                <g key={n.i} className={`tnode${n.x ? " ext" : ""}${n.more ? " more" : ""}`} transform={`translate(${d.y + 60},${d.x + off})`}>
                  <circle r={r} onClick={() => toggle(n)}>
                    {!n.more && <title>Click to expand/collapse</title>}
                  </circle>
                  <text x={14} dy="0.32em" onClick={() => { if (!n.more) go(n.i); }}>
                    {n.more ? n.n : (
                      <>
                        {n.x ? "† " : ""}
                        {isItalic(n) ? <tspan fontStyle="italic">{n.n}</tspan> : n.n}
                        {n.c && <tspan className="tc"> · {n.c}</tspan>}
                        {n.t ? <tspan className="tc"> ({fmtInt(n.t)})</tspan> : null}
                      </>
                    )}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
