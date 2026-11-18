---
description: "Save, list, and reopen named user-directed Activities independently of agent Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

English | [中文](README.zh.md)

## Summary

Save a named Activity with an objective and descriptive boundaries that remain available after its original Session ends. The Web and SDK /activity command can link selected Workspace and DSH Session identities, and another Session can reopen those references. Separate services store delegation facts, user-linked artifact pointers, and user dispositions with attributed verification evidence; review records never overwrite provider reports. Creating or opening an Activity does not execute its objective, create a Goal, or grant runtime permissions.

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

The Web and SDK profiles mount this service with the JSON StorageDomain provider, association service, and human /activity command. A composition that enables delegation also mounts the delegation service, subagent service, and a supported DSH-native provider.

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
- name: '@deepseek-ai/dsh-home-activity/artifacts'
- name: '@deepseek-ai/dsh-home-activity/reviews'
```

The storage providers own their settings; see the [JSON backend](../../storage/storage-json/README.md) and [StorageDomain](../../storage/storage-domain/README.md) references.

A composition that enables delegation also mounts `@deepseek-ai/dsh-home-activity/delegations`, `@deepseek-ai/dsh-subagent`, and a DSH-native provider supported by the command. The Web profile includes the `spawn` provider.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Activity records use the version-1 `home_activities` StorageDomain and remain independent of Session, Goal, and Workspace records. Delegations use a separate version-1 `home_activity_delegations` domain; each request saves the proposed child Session id before startup, followed by separate admission and report facts. The proposed id does not confirm admission. A restart changes unfinished records to `unconfirmed` and never restarts a child.

Selected Workspace and DSH Session references use the separate version-1 `home_activity_associations` domain. The associations are resolved against their owning registries when displayed; stale references remain explicit until removed. They do not change Workspace records, Session logs, or the Activity record.

User-linked artifact pointers use the separate version-1 `home_activity_artifacts` domain. Each pointer names one Activity, one of its delegations, and one Workspace already linked to that Activity; the user supplies its label, location, and optional revision. A missing revision is shown as unknown. Opening the Activity displays the delegation's requesting Session separately from the user-selected Workspace and states that their relationship to the reported output is unverified. The pointer remains separate from the provider-authored delegation report and establishes neither artifact origin, verification, nor acceptance. Workspace directories are displayed as selected contexts; a shared checkout or Git root is not inferred.

Outcome reviews use the separate version-1 `home_activity_reviews` domain, keyed by delegation identity and linked to its owning Activity. No saved review means the user disposition is pending. The user can record an explicit disposition and append attributed evidence; each evidence entry remains visibly user-supplied and unchecked by DSH. Updating the disposition preserves evidence and does not change request, admission, or provider-report facts.

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
| [`src/artifact-types.ts`](src/artifact-types.ts) | User-linked artifact pointer types |
| [`src/artifact-spec.ts`](src/artifact-spec.ts) | Versioned artifact pointer schema |
| [`src/artifacts.ts`](src/artifacts.ts) | Separate artifact pointer StorageDomain service |
| [`src/review-types.ts`](src/review-types.ts) | User disposition and evidence types |
| [`src/review-spec.ts`](src/review-spec.ts) | Versioned review record schema |
| [`src/reviews.ts`](src/reviews.ts) | Separate review StorageDomain service |
| [`tests/activity.spec.ts`](tests/activity.spec.ts) | Storage close, reopen, and validation behavior |
| [`tests/delegations.spec.ts`](tests/delegations.spec.ts) | Delegation fact persistence, restart recovery, and validation |
| [`tests/associations.spec.ts`](tests/associations.spec.ts) | Association validation, restart recovery, idempotence, and write rollback |
| [`tests/artifacts.spec.ts`](tests/artifacts.spec.ts) | Pointer restart recovery, Workspace attribution, and cross-Activity rejection |
| [`tests/reviews.spec.ts`](tests/reviews.spec.ts) | Review persistence, restart recovery, disposition changes, evidence attribution, and ownership checks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home Activity subsystem](../../../docs/subsystems/home-activity.md) — domain and persistence semantics.
- [StorageDomain](../../storage/storage-domain/README.md) — versioned host-side records.
- [Web `/activity` command](../../interaction/command-home-activity/README.md) — create, list, open, and review Activities.

-----

<a id="model-experience"></a>
## Model Experience

None, as the service persists Activity records without adding model context or tools.

#### KV Cache effect

None; creating or opening an Activity does not add model input. A delegated child Session makes its own provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Activity scope remains descriptive, and delegation does not enforce it as an authorization rule.

- Boundaries are descriptive statements, not sandbox roots or permission grants.
- Delegation records identify the requesting Session and the admitted child Session but do not create Activity-to-Session links or reusable knowledge.
- Workspace and Session references are selected independently. A Workspace id names a registered DSH Workspace directory, not an inferred repository root, and sharing an Activity does not assign a Session to a Workspace.
- Delegated execution is a separate explicit `/activity delegate` command; the Activity service itself has no edit, delete, or scheduling operation. Provider-reported output is not verified or accepted.
- Artifact references are user-linked pointers. They do not copy or inspect output, prove its producer, verify contents, or trigger cross-Workspace writes, merges, or releases. A missing source revision remains unknown.
- Review evidence and its reported result are user supplied. DSH preserves their source attribution but does not check the source, evidence, or outcome; the current disposition is separate from provider execution status.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
