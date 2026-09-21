import { card, escapeText, header } from './shared.js';

export function dashboard(snapshot, storage) {
  return '<div class="data-page">' + header('WORKSPACE', 'Overview', 'A control room for live market data, GitHub-backed replay datasets and research jobs.') +
    '<div class="data-card-grid">' + card('Loaded candles', Number(snapshot.count || 0).toLocaleString()) +
    card('Current dataset', snapshot.symbol ? escapeText(snapshot.symbol) + ' · ' + escapeText(snapshot.timeframe) : 'None') +
    card('Cache intervals', snapshot.coverage?.length || 0) +
    card('Replay source', snapshot.replayDatasetSource === 'local' ? 'Browser local' : 'GitHub') +
    '</div><section class="data-panel"><h2>Quick actions</h2><div class="data-action-grid"><a href="#downloads">Download and publish historical data</a><a href="#datasets">Manage datasets</a><a href="#validation">Validate current data</a><a href="#storage">Inspect storage</a></div></section><section class="data-panel"><h2>Current dataset</h2><dl class="data-detail-grid"><div><dt>Symbol</dt><dd>' + escapeText(snapshot.symbol || 'None') + '</dd></div><div><dt>Timeframe</dt><dd>' + escapeText(snapshot.timeframe || 'None') + '</dd></div><div><dt>Rows</dt><dd>' + Number(snapshot.count || 0).toLocaleString() + '</dd></div><div><dt>Source</dt><dd>' + escapeText(snapshot.replayDatasetSource || 'None') + '</dd></div></dl></section></div>';
}

export function downloads(snapshot, download, dates) {
  const symbol = snapshot.symbol || 'SOLUSDT';
  const timeframe = snapshot.timeframe || '15m';
  const error = download.error ? '<div class="data-alert" role="alert">' + escapeText(download.error) + '</div>' : '';
  const progress = ['running', 'starting'].includes(download.status)
    ? '<div class="download-progress"><div class="progress-track"><span style="width:' + Math.max(0, Math.min(100, Number(download.pct) || 0)) + '%"></span></div><div><strong>' + Number(download.pct || 0).toFixed(0) + '%</strong><span>' + Number(download.loaded || 0).toLocaleString() + ' / ' + Number(download.total || 0).toLocaleString() + ' candles</span></div></div>'
    : '';
  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  return '<div class="data-page">' + header('DATA / DOWNLOADS', 'Download Center', 'Download validated historical Binance candles and publish them as an immutable replay dataset to GitHub.') +
    error + '<section class="data-panel"><form class="data-form" novalidate><label>Symbol<input id="data-symbol" value="' + escapeText(symbol) + '" autocomplete="off" spellcheck="false"></label><label>Timeframe<select id="data-timeframe">' +
    timeframes.map((tf) => '<option value="' + tf + '" ' + (tf === timeframe ? 'selected' : '') + '>' + tf + '</option>').join('') +
    '</select></label><label>Start<input id="data-from" type="datetime-local" value="' + dates.start + '"></label><label>End<input id="data-to" type="datetime-local" value="' + dates.end + '"></label><button class="data-primary" type="button" data-data-action="download" ' +
    (['running', 'starting'].includes(download.status) ? 'disabled' : '') + '>' + (download.status === 'complete' ? 'Download and publish again' : 'Download and publish') + '</button>' +
    (['running', 'starting'].includes(download.status) ? '<button type="button" data-data-action="cancel-download">Cancel</button>' : '') +
    '</form>' + progress + '<p class="data-note">Downloads are server-owned Binance jobs. The validated dataset is published to GitHub. From the Datasets page you can download that dataset as a CSV and reopen it locally in any browser.</p></section>' +
    '<section class="data-panel"><h2>Download lifecycle</h2><ol class="data-steps"><li>Normalize the requested candle range.</li><li>Run the download on the server.</li><li>Fetch Binance Futures klines with pagination and integrity checks.</li><li>Publish the validated candles as an immutable GitHub dataset.</li></ol></section></div>';
}

function remoteDatasetRow(dataset) {
  const size = (Number(dataset.partitions?.reduce?.((sum, part) => sum + Number(part.byteLength || 0), 0) || dataset.byteLength || 0) / 1048576).toFixed(2);
  return '<tr><td><strong>' + escapeText(dataset.symbol) + '</strong></td><td>' + escapeText(dataset.timeframe) + '</td><td>' + Number(dataset.count || 0).toLocaleString() + '</td><td>' + size + ' MB</td><td>' + (dataset.status === 'validated' ? 'VALID' : escapeText(dataset.status || 'UNKNOWN')) + '</td><td><div class="dataset-actions">' +
    '<button type="button" data-data-action="open-replay" data-dataset-id="' + escapeText(dataset.id) + '" data-dataset-source="github">Replay</button>' +
    '<button type="button" data-data-action="export-dataset" data-dataset-id="' + escapeText(dataset.id) + '" data-dataset-source="github">Download CSV</button></div></td></tr>';
}

function localDatasetRow(dataset) {
  return '<tr><td><strong>' + escapeText(dataset.symbol) + '</strong></td><td>' + escapeText(dataset.timeframe) + '</td><td>' + Number(dataset.count || 0).toLocaleString() + '</td><td>Browser</td><td>LOCAL</td><td><div class="dataset-actions">' +
    '<button type="button" data-data-action="open-replay" data-dataset-id="' + escapeText(dataset.id) + '" data-dataset-source="local">Replay</button>' +
    '<button type="button" data-data-action="export-dataset" data-dataset-id="' + escapeText(dataset.id) + '" data-dataset-source="local">Download CSV</button>' +
    '<button type="button" data-data-action="delete-local-dataset" data-dataset-id="' + escapeText(dataset.id) + '">Remove</button></div></td></tr>';
}

export function datasets(snapshot, savedDatasets = [], localDatasets = []) {
  const remoteRows = savedDatasets.length
    ? savedDatasets.map(remoteDatasetRow).join('')
    : '<tr><td colspan="6">No GitHub replay datasets. Use Downloads to publish one.</td></tr>';
  const localRows = localDatasets.length
    ? localDatasets.map(localDatasetRow).join('')
    : '<tr><td colspan="6">No browser-local datasets. Download a CSV above, then use Open local CSV.</td></tr>';

  return '<div class="data-page">' + header('DATA / DATASETS', 'Dataset Library', 'GitHub is the durable research copy. Browser-local datasets are reusable copies imported from CSV files and stored in this browser.') +
    '<section class="data-panel"><div class="data-card-grid">' +
    card('GitHub datasets', savedDatasets.length.toLocaleString()) +
    card('Local datasets', localDatasets.length.toLocaleString()) +
    card('Active replay', snapshot.replayDatasetId ? escapeText(snapshot.replayDatasetSource || 'Selected') : 'None') +
    card('Local storage', 'IndexedDB') +
    '</div><div class="data-action-grid"><button type="button" class="data-primary" data-data-action="open-local-file">Open local CSV</button><input id="local-dataset-input" type="file" accept=".csv,text/csv" multiple hidden></div>' +
    '<p class="data-note">Use <strong>Download CSV</strong> on a GitHub dataset to save the actual file through your current browser. Later, <strong>Open local CSV</strong> imports that file into this browser. Local replay does not fetch historical candles from GitHub.</p></section>' +
    '<section class="data-panel"><h2>GitHub datasets</h2><div class="data-table-wrap"><table><thead><tr><th>Symbol</th><th>TF</th><th>Candles</th><th>Size</th><th>Quality</th><th>Actions</th></tr></thead><tbody>' + remoteRows + '</tbody></table></div></section>' +
    '<section class="data-panel"><h2>Browser-local datasets</h2><div class="data-table-wrap"><table><thead><tr><th>Symbol</th><th>TF</th><th>Candles</th><th>Storage</th><th>Quality</th><th>Actions</th></tr></thead><tbody>' + localRows + '</tbody></table></div></section></div>';
}

export function validation(snapshot, validationState) {
  const status = validationState?.status || (snapshot.metadata?.quality === 'VALID' ? 'valid' : snapshot.count ? 'not-run' : 'empty');
  const label = status === 'valid' ? 'VALID' : status === 'issues' ? 'ISSUES FOUND' : status === 'empty' ? 'NO DATA' : 'NOT RUN';
  const detail = validationState?.metadata ? 'Invalid: ' + (validationState.metadata.invalidCount ?? 0) + ' · Gaps: ' + (validationState.metadata.gaps?.length ?? 0) : 'Run validation against the active candle store.';
  return '<div class="data-page">' + header('DATA / VALIDATION', 'Data Quality', 'Make dataset integrity visible before research consumes it.') + '<section class="data-panel validation-card"><div class="validation-status ' + escapeText(status) + '"><span>' + label + '</span><strong>' + Number(snapshot.count || 0).toLocaleString() + ' candles</strong><small>' + escapeText(detail) + '</small></div><button class="data-primary" type="button" data-data-action="validate">Validate current dataset</button></section></div>';
}

export function storage(snapshot, storageEstimate) {
  const usage = storageEstimate?.usage;
  const quota = storageEstimate?.quota;
  const percentage = usage && quota ? usage / quota * 100 : null;
  return '<div class="data-page">' + header('DATA / STORAGE', 'Storage', 'Inspect browser storage used for disposable acceleration and imported local replay datasets.') +
    '<div class="data-card-grid">' + card('Used', usage != null ? (usage / 1073741824).toFixed(2) + ' GB' : 'Unavailable') +
    card('Quota', quota != null ? (quota / 1073741824).toFixed(2) + ' GB' : 'Unavailable') +
    card('Usage', percentage != null ? percentage.toFixed(1) + '%' : 'Unavailable') +
    card('Replay authority', snapshot.replayDatasetSource === 'local' ? 'Browser local' : 'GitHub') + '</div>' +
    '<section class="data-panel"><h2>Storage policy</h2><p>GitHub remains the durable dataset authority. IndexedDB also stores imported local replay datasets so they survive page reloads in this browser. Live Binance data and replay data remain separate paths.</p></section></div>';
}

export function jobs(jobsState) {
  const rows = jobsState.length
    ? jobsState.map((job) => '<tr><td>' + escapeText(job.name) + '</td><td><span class="job-status ' + escapeText(job.status) + '">' + escapeText(job.status) + '</span></td><td>' + (job.progress != null ? Number(job.progress).toFixed(0) + '%' : '—') + '</td></tr>').join('')
    : '<tr><td colspan="3">No jobs have run in this session.</td></tr>';
  return '<div class="data-page">' + header('SYSTEM / JOBS', 'Jobs', 'A lightweight audit trail for data operations started in this browser session.') + '<section class="data-panel"><div class="data-table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Progress</th></tr></thead><tbody>' + rows + '</tbody></table></div></section></div>';
}

export function system(snapshot) {
  return '<div class="data-page">' + header('SYSTEM', 'System', 'Runtime capabilities and data-service health.') +
    '<div class="data-card-grid">' + card('Replay data service', 'Ready') + card('IndexedDB', snapshot.cacheEnabled ? 'Available' : 'Unavailable') +
    card('Candle store', Number(snapshot.count || 0).toLocaleString() + ' rows') + card('Replay source', escapeText(snapshot.replayDatasetSource || 'None')) + '</div>' +
    '<section class="data-panel"><h2>Architecture</h2><p>Live data comes from Binance. Server downloads publish immutable GitHub datasets. A browser-local CSV can be imported into IndexedDB and then used as the replay dataset source.</p></section></div>';
}
