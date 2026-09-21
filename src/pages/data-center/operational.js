import { card, escapeText, header } from './shared.js';

export function dashboard(snapshot, storage) {
  return `<div class="data-page">${header('WORKSPACE','Overview','A control room for Binance market data, stored replay datasets and research jobs.')}<div class="data-card-grid">${card('Replay candles',Number(snapshot.count||0).toLocaleString())}${card('Current dataset',snapshot.symbol?`${escapeText(snapshot.symbol)} · ${escapeText(snapshot.timeframe)}`:'None')}${card('Stored datasets',snapshot.datasets?.length||0)}${card('Browser storage',storage?.usage!=null?`${(storage.usage/1073741824).toFixed(2)} GB`:'Unavailable')}</div><section class="data-panel"><h2>Quick actions</h2><div class="data-action-grid"><a href="#downloads">Download Binance data</a><a href="#datasets">Manage stored datasets</a><a href="#validation">Validate current data</a><a href="#storage">Inspect storage</a></div></section><section class="data-panel"><h2>Current dataset</h2><dl class="data-detail-grid"><div><dt>Symbol</dt><dd>${escapeText(snapshot.symbol||'None')}</dd></div><div><dt>Timeframe</dt><dd>${escapeText(snapshot.timeframe||'None')}</dd></div><div><dt>Rows</dt><dd>${Number(snapshot.count||0).toLocaleString()}</dd></div><div><dt>Quality</dt><dd>${escapeText(snapshot.metadata?.quality||'Unknown')}</dd></div></dl></section></div>`;
}

export function downloads(snapshot, download, dates) {
  const symbol = snapshot.symbol || 'SOLUSDT';
  const timeframe = snapshot.timeframe || '15m';
  const error = download.error ? `<div class="data-alert" role="alert">${escapeText(download.error)}</div>` : '';
  const progress = ['running','starting'].includes(download.status)
    ? `<div class="download-progress"><div class="progress-track"><span style="width:${Math.max(0,Math.min(100,Number(download.pct)||0))}%"></span></div><div><strong>${Number(download.pct||0).toFixed(0)}%</strong><span>${Number(download.loaded||0).toLocaleString()} / ${Number(download.total||0).toLocaleString()} candles</span></div></div>`
    : '';
  const timeframes = ['1m','5m','15m','30m','1h','4h','1d'];
  return `<div class="data-page">${header('DATA / DOWNLOADS','Download Center','Download Binance historical candles into the local Parquet store.')}${error}<section class="data-panel"><form class="data-form" novalidate><label>Symbol<input id="data-symbol" value="${escapeText(symbol)}" autocomplete="off" spellcheck="false"></label><label>Timeframe<select id="data-timeframe">${timeframes.map((tf)=>`<option value="${tf}" ${tf===timeframe?'selected':''}>${tf}</option>`).join('')}</select></label><label>Start<input id="data-from" type="datetime-local" value="${dates.start}"></label><label>End<input id="data-to" type="datetime-local" value="${dates.end}"></label><button class="data-primary" type="button" data-data-action="download" ${['running','starting'].includes(download.status)?'disabled':''}>${download.status==='complete'?'Download again':'Start download'}</button></form>${progress}<p class="data-note">This process writes an immutable Parquet dataset on the FastAPI machine and never loads the replay engine.</p></section><section class="data-panel"><h2>Download lifecycle</h2><ol class="data-steps"><li>Request the selected range from Binance Futures.</li><li>Validate timestamps and OHLC values.</li><li>Write an immutable Parquet file.</li><li>Replay later reads that stored file only.</li></ol></section></div>`;
}

export function datasets(snapshot) {
  const datasets = Array.isArray(snapshot.datasets) ? snapshot.datasets : [];
  const rows = datasets.length
    ? datasets.map((dataset)=>`<tr><td>${escapeText(dataset.symbol)}</td><td>${escapeText(dataset.timeframe)}</td><td>${new Date(Number(dataset.start)*1000).toISOString()}</td><td>${new Date(Number(dataset.end)*1000).toISOString()}</td><td>${Number(dataset.count||0).toLocaleString()}</td></tr>`).join('')
    : '<tr><td colspan="5">No local Parquet datasets have been downloaded yet.</td></tr>';
  return `<div class="data-page">${header('DATA / DATASETS','Dataset Manager','These are the local Parquet files available to replay.')}<section class="data-panel"><div class="data-card-grid">${card('Current symbol',escapeText(snapshot.symbol||'None'))}${card('Current timeframe',escapeText(snapshot.timeframe||'None'))}${card('Replay rows',Number(snapshot.count||0).toLocaleString())}${card('Stored datasets',datasets.length)}</div></section><section class="data-panel"><div class="data-panel-head"><h2>Local Parquet datasets</h2><button type="button" data-data-action="clear-current">Clear browser replay cache</button></div><div class="data-table-wrap"><table><thead><tr><th>Symbol</th><th>Timeframe</th><th>From</th><th>To</th><th>Rows</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
}
export function validation(snapshot, validationState) {
  const status = validationState?.status || (snapshot.metadata?.quality === 'VALID' ? 'valid' : snapshot.count ? 'not-run' : 'empty');
  const label = status === 'valid' ? 'VALID' : status === 'issues' ? 'ISSUES FOUND' : status === 'empty' ? 'NO DATA' : 'NOT RUN';
  const detail = validationState?.metadata ? `Invalid: ${validationState.metadata.invalidCount??0} · Gaps: ${validationState.metadata.gaps?.length??0}` : 'Run validation against the active replay candle store.';
  return `<div class="data-page">${header('DATA / VALIDATION','Data Quality','Make dataset integrity visible before research consumes it.')}<section class="data-panel validation-card"><div class="validation-status ${escapeText(status)}"><span>${label}</span><strong>${Number(snapshot.count||0).toLocaleString()} candles</strong><small>${escapeText(detail)}</small></div><button class="data-primary" type="button" data-data-action="validate">Validate current dataset</button></section></div>`;
}

export function storage(snapshot, storageEstimate) {
  const usage = storageEstimate?.usage;
  const quota = storageEstimate?.quota;
  const percentage = usage && quota ? usage / quota * 100 : null;
  return `<div class="data-page">${header('DATA / STORAGE','Storage','Understand how much browser storage is available to the replay cache.')}<div class="data-card-grid">${card('Used',usage!=null?`${(usage/1073741824).toFixed(2)} GB`:'Unavailable')}${card('Quota',quota!=null?`${(quota/1073741824).toFixed(2)} GB`:'Unavailable')}${card('Usage',percentage!=null?`${percentage.toFixed(1)}%`:'Unavailable')}${card('Cache',snapshot.cacheEnabled?'IndexedDB enabled':'Memory only')}</div><section class="data-panel"><h2>Storage policy</h2><p>Parquet files are the replay source of truth. Browser cache data can be deleted without deleting the underlying dataset.</p></section></div>`;
}

export function jobs(jobsState) {
  const rows = jobsState.length
    ? jobsState.map((job)=>`<tr><td>${escapeText(job.name)}</td><td><span class="job-status ${escapeText(job.status)}">${escapeText(job.status)}</span></td><td>${job.progress!=null?`${Number(job.progress).toFixed(0)}%`:'—'}</td></tr>`).join('')
    : '<tr><td colspan="3">No jobs have run in this session.</td></tr>';
  return `<div class="data-page">${header('SYSTEM / JOBS','Jobs','A lightweight audit trail for data operations started in this browser session.')}<section class="data-panel"><div class="data-table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
}

export function system(snapshot) {
  return `<div class="data-page">${header('SYSTEM','System','Runtime capabilities and data-service health.')}<div class="data-card-grid">${card('Live market service','Binance')}${card('Replay source','Local Parquet')}${card('Replay rows',`${Number(snapshot.count||0).toLocaleString()} rows`)}${card('Browser cache',snapshot.cacheEnabled?'Available':'Unavailable')}</div><section class="data-panel"><h2>Architecture</h2><p>Live mode reads Binance. Replay mode reads only stored Parquet. The download workflow is separate from both.</p></section></div>`;
}
