---
description: "Save, list, and reopen named user-directed Activities independently of agent Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

English | [中文](README.zh.md)

## Summary

Save named Activities with objectives and descriptive scope beyond their Sessions. The Web and SDK `/activity` command reopens them across Sessions and records selected Workspace and Session links, annotations, delegations, reports, handoffs, reviews, and append-only responsibility facts. An explicit `/activity assess` can save an advisory strategic brief for later Sessions. Creating or opening an Activity never starts work, activates a Goal, or grants permissions; external handoffs do not become native execution records.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web and SDK profiles mount this service with the JSON StorageDomain provider, association and annotation services, and the human `/activity` command. A composition that records responsibility histories also mounts `@deepseek-ai/dsh-home-activity/responsibilities`. Authenticated coordination routes are a separate consumer and record the local owner identity for confirmations without persisting unrelated Peer metadata.

### When to choose it

Choose an Activity when a user-directed undertaking needs a stable identity and saved intent independent of a Session. Use a Session for interaction history, a Goal for same-Session completion tracking, or a Workspace project for directory grouping.

### Minimal configuration

The service declares no configuration fields. A custom composition supplies the existing storage stack before mounting the service:

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/storages
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-home-activity'
- name: '@deepseek-ai/dsh-home-activity/associations'
- name: '@deepseek-ai/dsh-home-activity/annotations'
- name: '@deepseek-ai/dsh-home-activity/strategic-episodes'
- name: '@deepseek-ai/dsh-home-activity/handoffs'
- name: '@deepseek-ai/dsh-home-activity/responsibilities'
```

The storage providers own their settings; see the [JSON backend](../../storage/storage-json/README.md) and [StorageDomain](../../storage/storage-domain/README.md) references.

The optional Host `@deepseek-ai/dsh-home-activity/coordination` service exposes authenticated Client routes for bounded discovery and responsibility supervision. It rechecks Activity associations, Workspace membership, root Session identity, matching repository paths, and current access on each read or dispatch. Responsibility histories are returned only when the caller can read the source coordinator Session, target Session, and Workspace; Activity links alone grant no access. Discovery is passive. Responsibility records do not authorize access, and only an authenticated owner confirmation can dispatch the saved proposal through the target Session's native prompt route. See the [coordination UI](../../client/ui-activity-coordination/README.md) for the user interaction and its evidence limits.

A composition that enables delegation also mounts `@deepseek-ai/dsh-home-activity/delegations`, `@deepseek-ai/dsh-subagent`, and a provider supported by the command. The Web profile includes the `spawn` provider; `codex` and `claude-code` are available when their optional native providers are enabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Activity records use the version-1 `home_activities` StorageDomain and remain independent of Session, Goal, and Workspace records. Delegations use a separate version-5 `home_activity_delegations` domain that reads version-1 through version-4 records. Version 3 first added the Codex start outcome that a strict version-2 reader cannot decode; version 4 records the selected profile and preset at launch; version 5 adds native Claude Code one-shot delegation facts. Existing records without a profile and preset snapshot remain readable and display those facts as unavailable. New DSH `spawn` requests snapshot the profile name, ordered launch bundle list, active Agent preset id, and module names before startup. A bundle list is classified stable only when it exactly matches a shipped profile template, and experimental only when the product marks a selected bundle or module experimental; preset stability remains unavailable without explicit product classification. Profile patches and overlays are not included in bundle-set classification. Native Codex and Claude Code requests state that DSH cannot inspect the external profile or preset. These labels do not establish sandbox isolation, permission enforcement, or Skill qualification. Later configuration changes do not rewrite a saved profile and preset snapshot. Existing `spawn` rows keep their original fields; new `spawn` requests save a proposed child Session id before startup, while Codex and Claude Code requests do not invent a DSH Session identity. External admissions store the provider's one-shot `SubagentRun.id`, not a DSH Session or native provider conversation id. Each provider saves separate admission and report facts. The proposed `spawn` id does not confirm admission. A restart changes unfinished records to `unconfirmed` and never restarts execution. Typed `PROVIDER_CHANGED` and `NOT_DISPATCHED` failures occur before provider invocation and are recorded as not admitted; Codex or Claude Code startup rejection after provider invocation begins is `unconfirmed` because the external run may have started. Do not repeat an unconfirmed task unless you independently confirm that it did not start.

User corrections use a separate version-1 `home_activity_annotations` domain. Each immutable `user-command` revision supersedes only the previous annotation for that Activity and leaves Activity and delegation records unchanged; the domain retains up to 256 revisions. Note text rejects control, format, line, and paragraph separators so displayed history remains line-oriented.

Strategic briefs use a separate append-only version-1 `home_activity_strategic_episodes` domain. A record retains the Activity objective, originating DSH Session, explicit Workspace ids, agent-authored findings and alternatives, repository-relative source references, coordinator-reported Git revisions and observation times, whether tracked and unignored working files had staged, unstaged, or untracked changes, loaded Sensemaking Skill content digests, uncertainties, and a recommendation or explicit no-selection. The recorder binds repository identities and source metadata to matching successful coordinator tool-result metadata in the originating Session; it does not independently verify repository contents or the findings. A brief is incomplete if a selected Workspace was unavailable, had uncommitted source changes, changed during observation, or has unknown source stability. For a dirty Workspace, `HEAD` identifies only the committed base; staged and working-tree source contents are not snapshotted, so a cited path may refer to content that is not recoverable from the saved episode. A repeated recorder call with the same request id returns the existing episode; later assessments append a superseding episode and preserve earlier source history. Opening an Activity shows its latest brief; `/activity brief <activity-id> <revision>` opens an earlier one without checking current repositories or repeating an assessment.

Selected Workspace and DSH Session references use the separate version-1 `home_activity_associations` domain. The associations are resolved against their owning registries when displayed; stale references remain explicit until removed. They do not change Workspace records, Session logs, or the Activity record.

Cross-Session responsibility facts use the separate append-only version-1 `home_activity_responsibilities` domain. A stable responsibility identity retains its immutable proposal, exact user confirmation, prompt dispatch intent and route outcome, passive Session observations, concise final target reports with source event sequences, verification evidence, and user disposition. Each new fact links to its predecessor; the service derives no completion status from Session activity. Authenticated user decisions record the local owner identity; other Peer metadata is not persisted. The domain does not authorize Session access or perform dispatch.

Target-authored interim progress uses a separate append-only version-1 `home_activity_responsibility_status_reports` domain. Each bounded report identifies its Activity, responsibility, target Session, dispatched prompt, and exact target `tool/call` event sequence. Reports are available only through the target-only command tool for an admitted or unresolved assignment; they do not change responsibility facts or imply completion, verification, or acceptance. The strict responsibility version-1 reader remains unchanged.

User-supplied external handoffs use the separate version-1 `home_activity_handoffs` domain. Each record belongs to an existing Activity and stores a source label, optional user summary or source reference, user-supplied artifact references, and the DSH Session in which the record was added. Supplied text is trimmed, length-bounded, and single-line; control, format, line-separator, and paragraph-separator characters are rejected. Opening the Activity from another Session shows these references as external user input, not imported native execution history. The service does not import transcripts, synchronize external sessions, establish who performed the work, or claim verification or acceptance.

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Activity identity and request types |
| [`src/spec.ts`](src/spec.ts) | Versioned persisted record schema |
| [`src/index.ts`](src/index.ts) | Activity catalog service |
| [`src/delegation-types.ts`](src/delegation-types.ts) | Delegation lifecycle fact types |
| [`src/delegation-spec.ts`](src/delegation-spec.ts) | Versioned delegation record schema |
| [`src/delegations.ts`](src/delegations.ts) | Separate delegation StorageDomain service |
| [`src/association-types.ts`](src/association-types.ts) | Workspace and Session reference types |
| [`src/association-spec.ts`](src/association-spec.ts) | Versioned association record schema |
| [`src/associations.ts`](src/associations.ts) | Separate association StorageDomain service |
| [`src/annotation-types.ts`](src/annotation-types.ts) | User-authored annotation revision types |
| [`src/annotation-spec.ts`](src/annotation-spec.ts) | Versioned annotation record schema and domain |
| [`src/annotations.ts`](src/annotations.ts) | Separate append-only annotation StorageDomain service |
| [`src/strategic-episode-types.ts`](src/strategic-episode-types.ts) | Strategic episode and evidence-reference types |
| [`src/strategic-episode-spec.ts`](src/strategic-episode-spec.ts) | Versioned strategic episode schema and domain |
| [`src/strategic-episodes.ts`](src/strategic-episodes.ts) | Append-only Activity Strategic Brief persistence service |
| [`src/responsibility-types.ts`](src/responsibility-types.ts) | Responsibility identities and immutable fact types |
| [`src/responsibility-spec.ts`](src/responsibility-spec.ts) | Versioned append-only responsibility record schema and domain |
| [`src/responsibility-status-spec.ts`](src/responsibility-status-spec.ts) | Separate versioned schema and domain for target-authored progress reports |
| [`src/responsibilities.ts`](src/responsibilities.ts) | Responsibility persistence service |
| [`src/activity-types.ts`](src/activity-types.ts) | Client-safe Activity identity and record types |
| [`src/coordination-types.ts`](src/coordination-types.ts) | Client-safe cross-Session request and observation types |
| [`src/coordination.ts`](src/coordination.ts) | Authenticated discovery, proposal, dispatch, and observation routes |
| [`src/handoff-types.ts`](src/handoff-types.ts) | External handoff record types |
| [`src/handoff-spec.ts`](src/handoff-spec.ts) | Versioned external handoff schema |
| [`src/handoffs.ts`](src/handoffs.ts) | Separate external handoff StorageDomain service |
| [`tests/handoffs.spec.ts`](tests/handoffs.spec.ts) | External handoff validation and persistence after storage context recreation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home Activity subsystem](../../../docs/subsystems/home-activity.md) — domain and persistence semantics.
- [StorageDomain](../../storage/storage-domain/README.md) — versioned host-side records.
- [Web `/activity` command](../../interaction/command-home-activity/README.md) — create, list, open, annotate, and review Activities.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes persistence services to the application but does not add model instructions or tools.

#### KV Cache effect

Activity storage itself adds no model input; an explicit command may put selected records into the active Session as described in `command-home-activity`.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Activity scope remains descriptive, and delegation does not enforce it as an authorization rule.

- Boundaries are descriptive statements, not sandbox roots or permission grants.
- Delegation records identify the requesting Session and admitted execution; only `spawn` creates a DSH child Session. Delegation does not create Activity-to-Session links or reusable knowledge.
- Workspace and Session references are selected independently. A Workspace id names a registered DSH Workspace directory, not an inferred repository root, and sharing an Activity does not assign a Session to a Workspace.
- User corrections append immutable annotation revisions in a separate version-1 domain, with a maximum of 256 revisions per Activity; `/activity open` displays the latest 8 and retains older revisions.
- Delegated execution is a separate explicit `/activity delegate` command; the Activity service itself has no edit, delete, or scheduling operation. Provider reports are not independently verified by DSH and do not determine the user's separate disposition. Native Codex and Claude Code delegation are one-shot and do not expose continuation, resume, transcript inspection, or rollback through Activity; each follows its native configuration and permission handling.
- Activity views classify only known provider stop reasons; unknown values remain unknown. They show the saved report source and time, and the uncertainty source category and observation time when available. DSH has no freshness check for a saved report, so it may be stale; opening an Activity does not query later provider state or retry work.
- Artifact references are user-linked pointers. They do not copy or inspect output, prove its producer, verify contents, or trigger cross-Workspace writes, merges, or releases. A missing source revision remains unknown.
- Review evidence and its reported result are user supplied. DSH preserves their source attribution but does not check the source, evidence, or outcome; the current disposition is separate from provider execution status.
- Responsibility confirmation is a saved fact supplied by an authenticated local owner route; this service does not authenticate that caller or grant access to the target Session. Prompt admission means the Session accepted the input, not that it executed the task. Reports retain a bounded summary and source event references rather than a transcript. Verification evidence records its named source and reported result without checking that source; acceptance is a separate user decision.
- Interim progress is a separate target self-report stored by exact Session call event. It is not a final outcome and may be inaccurate or outdated; no report status establishes completion, verification, or acceptance.
- Strategic episodes are agent-authored reports, not independent verification or user acceptance. Assessment requires both Sensemaking Skills to be loadable and exactly two registered Workspaces because the existing coordinator supports two repositories. The recorder binds repository ids, `HEAD` revisions, observation times, and working-tree cleanliness metadata to a matching successful coordinator result in the originating Session, but does not independently verify source contents, citations, or findings. For dirty sources, `HEAD` is the committed base only and the episode does not preserve staged or working-tree file contents. Unavailable, dirty, changed, or stability-unknown sources require an incomplete brief. `/activity open` shows the latest brief and `/activity brief` retrieves an earlier saved revision; neither command checks current repositories.

Annotation write errors do not confirm whether the revision was persisted. The JSON backend can fail after replacing its file, so close and reopen the backend and domain, then inspect the Activity before deciding whether to retry; the annotation service does not promise a durable rollback. See the [StorageDomain](../../storage/storage-domain/README.md) and [JSON backend](../../storage/storage-json/README.md) failure contracts.

- External handoffs are entered by a user through `/activity handoff add`; they do not import transcripts or synchronize an external agent. Source labels, summaries, and artifact references are user supplied and are not independently verified or accepted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
