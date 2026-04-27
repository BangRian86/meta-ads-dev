import { fmtRelative, html, safe, type SafeHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { CronJobStatus, WorkflowComponent } from '../data.js';

interface WorkflowsData {
  username: string;
  components: WorkflowComponent[];
  cronJobs: CronJobStatus[];
}

export function renderWorkflows(data: WorkflowsData): string {
  const body = html`
    <h1>Workflow explorer</h1>
    <p class="muted">
      End-to-end pipeline that turns Meta data into actions: each block reflects
      whether the underlying component has run recently.
    </p>

    <div class="card">
      <h2>Pipeline</h2>
      <div class="workflow-flow">
        ${flowSteps(data.components)}
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem">
      <h2>Component health</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Status</th>
              <th>Last activity</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>${data.components.map(componentRow)}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem">
      <h2>Scheduled jobs (cron)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>${data.cronJobs.map(cronRow)}</tbody>
        </table>
      </div>
      <p class="muted" style="margin:0.75rem 0 0;font-size:0.8rem">
        "Last run" is derived from the modification time of each job's log file
        in <code>/tmp/</code>. If a job hasn't logged yet the column shows "—".
      </p>
    </div>
  `;
  return renderPage(
    {
      title: 'Workflows',
      active: 'workflows',
      username: data.username,
      crumbs: [{ href: '/', label: 'Home' }, { label: 'Workflows' }],
    },
    body,
  );
}

function flowSteps(components: WorkflowComponent[]): SafeHtml[] {
  const out: SafeHtml[] = [];
  components.forEach((c, i) => {
    out.push(
      html`
        <div class="workflow-step">
          <div class="label">${c.label}</div>
          <div>${c.active ? html`<span class="badge good">active</span>` : html`<span class="badge warn">idle</span>`}</div>
          <div class="desc">${c.description}</div>
          <div class="meta muted" style="font-size:0.75rem">
            ${c.lastRunAt ? fmtRelative(c.lastRunAt) : '—'}
          </div>
        </div>
      `,
    );
    if (i < components.length - 1) {
      out.push(safe('<div class="workflow-arrow">→</div>'));
    }
  });
  return out;
}

function componentRow(c: WorkflowComponent): SafeHtml {
  return html`
    <tr>
      <td><strong>${c.label}</strong><div class="muted">${c.description}</div></td>
      <td>${c.active ? html`<span class="badge good">active</span>` : html`<span class="badge warn">idle</span>`}</td>
      <td class="muted">${c.lastRunAt ? fmtRelative(c.lastRunAt) : '—'}</td>
      <td class="muted">${c.detail ?? '—'}</td>
    </tr>
  `;
}

function cronRow(j: CronJobStatus): SafeHtml {
  return html`
    <tr>
      <td><strong>${j.id}</strong><div class="muted"><code>${j.command}</code></div></td>
      <td><code>${j.schedule}</code></td>
      <td class="muted">${j.lastRunAt ? fmtRelative(j.lastRunAt) : '—'}</td>
      <td>${j.description}</td>
    </tr>
  `;
}
