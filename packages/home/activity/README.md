---
description: "Save, list, and reopen named user-directed Activities independently of agent Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

English | [中文](README.zh.md)

## Summary

Save a named Activity with an objective and descriptive boundaries that remain available after its original Session ends. The Web `/activity` command can link selected Workspace and DSH Session identities, and another Session can reopen those references. Links do not assign a Session to a Workspace, execute the objective, create a Goal, or grant runtime permissions.

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

The Web profile mounts this service, the `@deepseek-ai/dsh-home-activity/associations` service, the JSON StorageDomain provider, and the human `/activity` command.

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
```

The storage providers own their settings; see the [JSON backend](../../storage/storage-json/README.md) and [StorageDomain](../../storage/storage-domain/README.md) references.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Activity records remain in the strict version-1 `home_activities` StorageDomain. Separately authored Workspace and Session references use the additive `home_activity_associations` version-1 domain. A Workspace link names a registered Workspace directory, not an inferred Git root; a Session link is a distinct identity and does not imply Workspace membership. Neither link rewrites a Session log or starts execution.

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Activity identity and request types |
| [`src/spec.ts`](src/spec.ts) | Versioned persisted record schema |
| [`src/index.ts`](src/index.ts) | StorageDomain service |
| [`src/association-types.ts`](src/association-types.ts) | Separate Workspace and Session references |
| [`src/association-spec.ts`](src/association-spec.ts) | Versioned association record schema |
| [`src/associations.ts`](src/associations.ts) | Association validation and StorageDomain service |
| [`tests/activity.spec.ts`](tests/activity.spec.ts) | Activity persistence and validation behavior |
| [`tests/associations.spec.ts`](tests/associations.spec.ts) | Association validation, restart, idempotence, and write rollback |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home Activity subsystem](../../../docs/subsystems/home-activity.md) — domain and persistence semantics.
- [StorageDomain](../../storage/storage-domain/README.md) — versioned host-side records.
- [Web `/activity` command](../../interaction/command-home-activity/README.md) — create, list, and open Activities.

-----

<a id="model-experience"></a>
## Model Experience

None, as the service persists Activity records without adding model context or tools.

#### KV Cache effect

None; Activity reads and writes do not change model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The current record and its separate references preserve user intent without coordinating execution.

- Boundaries are descriptive statements, not sandbox roots or permission grants.
- Workspace references identify DSH Workspace directory records and do not attest to Git repository roots. Workspace and Session references are authored independently and do not provide repository attribution or Session membership.
- Activities are not linked to delegated work, reusable knowledge, or execution evidence.
- The service has no edit, delete, scheduling, or execution operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
