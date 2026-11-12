<script>
  // The Werkbank's middle column for a planning step: the lesson state as an editable form.
  // Every edit is a patch the window hands to `conv.patchLesson`; nothing is sent to the model
  // until she presses "Weiter" (or "Weitere suchen" / "Teile anpassen").
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { PHASE_LABELS } from '$lib/termi/lesson-state.js';

  /**
   * @type {{
   *   n: number,
   *   lessonState: import('$lib/termi/lesson-state.js').LessonState | null,
   *   found: { uri?: string, label: string, topic?: string }[],
   *   isCurrent: boolean,
   *   busy: boolean,
   *   hasParts: boolean,
   *   onpatch: (patch: Record<string, any>) => boolean | void,
   *   onnext: () => void,
   *   onadapt: () => void,
   *   onmore?: () => void
   * }}
   */
  let { n, lessonState, found, isCurrent, busy, hasParts, onpatch, onnext, onadapt, onmore } =
    $props();

  const FRAME = /** @type {const} */ ([
    ['subject', m.termi_werkbank_field_subject],
    ['grade', m.termi_werkbank_field_grade],
    ['state', m.termi_werkbank_field_state],
    ['schoolType', m.termi_werkbank_field_schoolType],
    ['lessons', m.termi_werkbank_field_lessons],
    ['minutes', m.termi_werkbank_field_minutes],
    ['topic', m.termi_werkbank_field_topic],
    ['profile', m.termi_werkbank_field_profile]
  ]);
  const NUMERIC = ['lessons', 'minutes'];
  const inputClass = 'input input-sm w-full';

  const frame = $derived(lessonState?.frame ?? {});
  const chosen = $derived(lessonState?.competences ?? []);
  const plan = $derived(lessonState?.plan ?? []);
  // the labels are the identity: a found competence the plan holds is not offered twice
  const offered = $derived([
    ...chosen.map((c) => ({ c, on: true })),
    ...found.filter((f) => !chosen.some((c) => c.label === f.label)).map((c) => ({ c, on: false }))
  ]);
  const nextLabel = $derived((getLocale() === 'de' ? PHASE_LABELS.de : PHASE_LABELS.en)[n]);

  let ownGoal = $state('');

  /** A rejected patch (false) leaves the state as it was: the caller puts the control back. @param {Record<string, any>} patch */
  const commit = (patch) => onpatch(patch) !== false;

  /** @param {string} key @param {HTMLInputElement} el */
  function commitFrame(key, el) {
    const v = el.value.trim();
    const num = Number(v);
    const value = !v ? undefined : NUMERIC.includes(key) && Number.isFinite(num) ? num : v;
    if (!commit({ frame: { [key]: value } })) el.value = frame[key] ?? '';
  }

  /** @param {number} i @param {HTMLInputElement} el */
  function toggle(i, el) {
    const { c, on } = offered[i];
    if (!commit({ competences: on ? chosen.filter((x) => x.label !== c.label) : [...chosen, c] }))
      el.checked = on;
  }

  function addGoal() {
    const label = ownGoal.trim();
    if (label && commit({ competences: [...chosen, { label }] })) ownGoal = '';
  }

  /** @param {number} i @param {'goal'|'material'} field @param {HTMLInputElement} el */
  function commitRow(i, field, el) {
    const before = field === 'material' ? list(plan[i]?.material) : (plan[i]?.goal ?? '');
    const v =
      field === 'material'
        ? el.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : el.value;
    if (!commit({ plan: plan.map((row, j) => (j === i ? { ...row, [field]: v } : row)) }))
      el.value = before;
  }

  /** @param {unknown} v */
  const list = (v) => (Array.isArray(v) ? v.join(', ') : '');
</script>

<div data-testid="werkbank-step" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
  {#if n === 1}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each FRAME as [key, label] (key)}
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-semibold">{label()}</span>
          <input
            class={inputClass}
            value={frame[key] ?? ''}
            onchange={(e) => commitFrame(key, e.currentTarget)}
          />
        </label>
      {/each}
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-semibold">{m.termi_werkbank_field_licence()}</span>
        <input
          class={inputClass}
          value={lessonState?.licence ?? ''}
          onchange={(e) => {
            if (!commit({ licence: e.currentTarget.value.trim() }))
              e.currentTarget.value = lessonState?.licence ?? '';
          }}
        />
      </label>
    </div>
  {:else if n === 2}
    {#if !offered.length}
      <p class="text-sm text-base-content/70">{m.termi_werkbank_competences_empty()}</p>
    {/if}
    <ul class="flex flex-col gap-2">
      {#each offered as { c, on }, i (i)}
        <li>
          <label class="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="checkbox mt-0.5 checkbox-sm"
              checked={on}
              onchange={(e) => toggle(i, e.currentTarget)}
            />
            <span
              >{c.label}{#if c.topic}<span class="text-base-content/60">
                  · {c.topic}</span
                >{/if}</span
            >
          </label>
        </li>
      {/each}
    </ul>
    <div class="flex items-end gap-2">
      <label class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span class="font-semibold">{m.termi_werkbank_own_goal()}</span>
        <input
          class={inputClass}
          bind:value={ownGoal}
          onkeydown={(e) => e.key === 'Enter' && addGoal()}
        />
      </label>
      <button type="button" class="btn btn-sm" onclick={addGoal}
        >{m.termi_werkbank_add_goal()}</button
      >
    </div>
    {#if onmore}
      <div>
        <button type="button" class="btn btn-sm" disabled={busy} onclick={onmore}
          >{m.termi_werkbank_more_competences_btn()}</button
        >
      </div>
    {/if}
  {:else if n === 3}
    {@const d = lessonState?.didactics ?? {}}
    {#if d.phasing || d.methods?.length || d.differentiation}
      <dl class="flex flex-col gap-3 text-sm">
        {#if d.phasing}
          <div>
            <dt class="font-semibold">{m.termi_werkbank_didactics_phasing()}</dt>
            <dd>{d.phasing}</dd>
          </div>
        {/if}
        {#if d.methods?.length}
          <div>
            <dt class="font-semibold">{m.termi_werkbank_didactics_methods()}</dt>
            <dd>{list(d.methods)}</dd>
          </div>
        {/if}
        {#if d.differentiation}
          <div>
            <dt class="font-semibold">{m.termi_werkbank_didactics_differentiation()}</dt>
            <dd>{d.differentiation}</dd>
          </div>
        {/if}
      </dl>
    {:else}
      <p class="text-sm text-base-content/70">{m.termi_werkbank_didactics_empty()}</p>
    {/if}
  {:else if !plan.length}
    <p class="text-sm text-base-content/70">{m.termi_werkbank_plan_empty()}</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>{m.termi_werkbank_plan_n()}</th>
            <th>{m.termi_werkbank_plan_goal()}</th>
            <th>{m.termi_werkbank_plan_phases()}</th>
            <th>{m.termi_werkbank_plan_material()}</th>
          </tr>
        </thead>
        <tbody>
          {#each plan as row, i (i)}
            <tr>
              <td>{row.n ?? i + 1}</td>
              <td>
                <input
                  data-testid="werkbank-plan-goal"
                  class={inputClass}
                  aria-label={m.termi_werkbank_plan_goal()}
                  value={row.goal ?? ''}
                  onchange={(e) => commitRow(i, 'goal', e.currentTarget)}
                />
              </td>
              <td>{list(row.phases)}</td>
              <td>
                <input
                  data-testid="werkbank-plan-material"
                  class={inputClass}
                  aria-label={m.termi_werkbank_plan_material()}
                  value={list(row.material)}
                  onchange={(e) => commitRow(i, 'material', e.currentTarget)}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if isCurrent}
    <div>
      <button
        type="button"
        data-testid="werkbank-next"
        class="btn btn-sm btn-primary"
        disabled={busy}
        onclick={onnext}>{m.termi_werkbank_next({ next: nextLabel })}</button
      >
    </div>
  {:else if hasParts}
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <p class="text-base-content/70">{m.termi_werkbank_parts_not_rewritten()}</p>
      <button type="button" class="btn btn-sm" disabled={busy} onclick={onadapt}
        >{m.termi_werkbank_adapt_parts()}</button
      >
    </div>
  {/if}
</div>
