import type { Playbook } from "../registry/playbookSchema.js";
import type { Route } from "../registry/routeSchema.js";

export type PlaybookOverlapResult = {
  playbook_id: string;
  playbook_title: string;
  /** Recall: |shared| / |playbook components| — how much of the playbook is covered. */
  overlap_fraction: number;
  /** Precision: |shared| / |candidate components| — how much of the candidate is playbook. */
  precision: number;
  /**
   * Jaccard similarity: |shared| / |playbook ∪ candidate|.
   * A precision/recall-balanced similarity measure.
   */
  jaccard: number;
  shared_components: string[];
  /** Candidate components not in the playbook — possible compose noise or valid extensions. */
  extra_components: string[];
  /** Playbook components absent from the candidate — gaps to address. */
  missing_components: string[];
};

export type RouteOverlapResult = {
  route_id: string;
  route_name: string;
  /** Recall: |shared| / |route components|. */
  overlap_fraction: number;
  /** Precision: |shared| / |candidate components|. */
  precision: number;
  /** Jaccard similarity. */
  jaccard: number;
  shared_components: string[];
  extra_components: string[];
  missing_components: string[];
};

/**
 * Finds playbooks whose component list significantly overlaps with
 * the candidate component set (MAR-91).
 *
 * Returns full overlap stats — recall, precision, Jaccard, extra and missing
 * components — so callers can apply their own thresholds for playbook-first
 * routing. Results filtered to `recall >= minOverlap`, sorted by recall desc.
 */
export function findOverlappingPlaybooks(
  candidateIds: Set<string>,
  playbooks: Playbook[],
  minOverlap = 0.5,
): PlaybookOverlapResult[] {
  const results: PlaybookOverlapResult[] = [];
  const candidateSize = candidateIds.size;

  for (const pb of playbooks) {
    if (pb.components.length === 0) continue;

    const shared = pb.components.filter((id) => candidateIds.has(id));
    const recall = shared.length / pb.components.length;

    if (recall < minOverlap) continue;

    const precision = candidateSize > 0 ? shared.length / candidateSize : 0;
    const unionSize = pb.components.length + candidateSize - shared.length;
    const jaccard = unionSize > 0 ? shared.length / unionSize : 0;

    const sharedSet = new Set(shared);
    const extra_components = [...candidateIds].filter((id) => !sharedSet.has(id));
    const missing_components = pb.components.filter((id) => !candidateIds.has(id));

    results.push({
      playbook_id: pb.id,
      playbook_title: pb.title,
      overlap_fraction: Math.round(recall * 100) / 100,
      precision: Math.round(precision * 100) / 100,
      jaccard: Math.round(jaccard * 100) / 100,
      shared_components: shared,
      extra_components,
      missing_components,
    });
  }

  return results.sort((a, b) => b.overlap_fraction - a.overlap_fraction);
}

/**
 * Finds known routes whose component list overlaps with the candidate set.
 */
export function findOverlappingRoutes(
  candidateIds: Set<string>,
  routes: Route[],
  minOverlap = 0.5,
): RouteOverlapResult[] {
  const results: RouteOverlapResult[] = [];
  const candidateSize = candidateIds.size;

  for (const route of routes) {
    if (route.components.length === 0) continue;

    const shared = route.components.filter((id) => candidateIds.has(id));
    const recall = shared.length / route.components.length;

    if (recall < minOverlap) continue;

    const precision = candidateSize > 0 ? shared.length / candidateSize : 0;
    const unionSize = route.components.length + candidateSize - shared.length;
    const jaccard = unionSize > 0 ? shared.length / unionSize : 0;

    const sharedSet = new Set(shared);
    const extra_components = [...candidateIds].filter((id) => !sharedSet.has(id));
    const missing_components = route.components.filter((id) => !candidateIds.has(id));

    results.push({
      route_id: route.id,
      route_name: route.name,
      overlap_fraction: Math.round(recall * 100) / 100,
      precision: Math.round(precision * 100) / 100,
      jaccard: Math.round(jaccard * 100) / 100,
      shared_components: shared,
      extra_components,
      missing_components,
    });
  }

  return results.sort((a, b) => b.overlap_fraction - a.overlap_fraction);
}
