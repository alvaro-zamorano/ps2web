// PS2WEB(Sprint 1): visible game library over OPFS persistence.
// purei.org has none of this: import once -> persists across reloads -> one-click boot,
// with a searchable catalog of the 1302 tracker games and browser-verified badges.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayModule } from './PlayModule';
import { DiskStore, DiskEntry, bootFromOpfs, importFile } from './ps2web_diskstore';
import {
  CompatGame, MatchResult, matchImported, searchGames, compatCount, canonSerial,
} from './ps2web_compat';

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function Badge({ match }: { match: MatchResult | null }) {
  if (!match) return <span className="ps2-badge ps2-badge-muted">…</span>;
  if (match.verified) {
    return <span className="ps2-badge ps2-badge-ok" title={match.verified.notes || 'Verificado en navegador por ps2web'}>✔ verificado en navegador</span>;
  }
  if (match.tracker) {
    return <span className="ps2-badge ps2-badge-tracker" title={`Tracker Play! · issue #${match.tracker.issue ?? '?'}`}>✔ en tracker de Play!</span>;
  }
  return <span className="ps2-badge ps2-badge-muted">sin datos del tracker</span>;
}

function GameCard(props: { entry: DiskEntry; onBoot: (n: string) => void; onDelete: (n: string) => void; booting: boolean; }) {
  const { entry, onBoot, onDelete, booting } = props;
  const [match, setMatch] = useState<MatchResult | null>(null);
  useEffect(() => { let live = true; matchImported(entry.name).then(m => { if (live) setMatch(m); }); return () => { live = false; }; }, [entry.name]);
  const title = match && match.tracker ? match.tracker.title : entry.name;
  return (
    <div className="ps2-card" data-game={entry.name}>
      <div className="ps2-card-title" title={entry.name}>{title}</div>
      <div className="ps2-card-meta">{fmtSize(entry.size)}{match && match.serial ? ' · ' + match.serial : ''}</div>
      <Badge match={match} />
      <div className="ps2-card-actions">
        <button className="ps2-btn ps2-btn-play" disabled={booting} onClick={() => onBoot(entry.name)}>▶ Jugar</button>
        <button className="ps2-btn ps2-btn-del" onClick={() => onDelete(entry.name)}>🗑 Borrar</button>
      </div>
    </div>
  );
}

export function Library({ ready }: { ready: boolean }) {
  const [entries, setEntries] = useState<DiskEntry[]>([]);
  const [booting, setBooting] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [total, setTotal] = useState<number>(0);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<CompatGame[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setEntries(await DiskStore.listDetailed()); } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => { refresh(); compatCount().then(setTotal).catch(() => {}); }, [refresh]);

  const onImport = useCallback(async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setStatus(`Importando ${f.name}…`);
    try {
      const saved = await importFile(f, (written, total) => {
        const pct = total ? Math.round((written / total) * 100) : 100;
        setStatus(`Importando ${f.name}… ${pct}% (${fmtSize(written)}/${fmtSize(total)})`);
      });
      setStatus(`Guardado en tu biblioteca: ${saved.name} (${fmtSize(saved.size)})`);
      await refresh();
    } catch (e: any) {
      setStatus(`Error importando: ${e && e.message ? e.message : e}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [refresh]);

  const onBoot = useCallback(async (name: string) => {
    if (!PlayModule) { setStatus('El emulador aún no está listo.'); return; }
    setBooting(name);
    setStatus(`Arrancando ${name}…`);
    try {
      await bootFromOpfs(PlayModule, name);
      setStatus(`Ejecutando ${name}.`);
    } catch (e: any) {
      setStatus(`Error al arrancar: ${e && e.message ? e.message : e}`);
    } finally {
      setBooting(null);
    }
  }, []);

  const onDelete = useCallback(async (name: string) => {
    // eslint-disable-next-line no-restricted-globals
    if (typeof window !== 'undefined' && window.confirm && !window.confirm(`¿Borrar ${name} de la biblioteca?`)) return;
    try { await DiskStore.remove(name); await refresh(); setStatus(`Borrado ${name}.`); }
    catch (e: any) { setStatus(`Error borrando: ${e && e.message ? e.message : e}`); }
  }, [refresh]);

  useEffect(() => {
    let live = true;
    const h = setTimeout(() => { searchGames(query).then(r => { if (live) setResults(r); }); }, 150);
    return () => { live = false; clearTimeout(h); };
  }, [query]);

  const ownedSerials = new Set(entries.map(e => canonSerial(e.name)));

  return (
    <div className="ps2-library">
      <div className="ps2-toolbar">
        <label className="ps2-btn ps2-btn-import">
          + Importar juego
          <input ref={fileRef} type="file" accept=".iso,.cso,.chd,.isz,.bin,.elf" onChange={onImport} style={{ display: 'none' }} data-testid="ps2-import" />
        </label>
        <span className="ps2-status" data-testid="ps2-status">{status || (ready ? 'Emulador listo.' : 'Cargando emulador…')}</span>
      </div>

      <h2 className="ps2-h2">Tu biblioteca <span className="ps2-count">{entries.length}</span></h2>
      {entries.length === 0 ? (
        <p className="ps2-empty">Importa una ISO/CHD/ELF y quedará guardada aquí — sobrevive a recargas y reinicios del navegador (OPFS). purei.org no guarda nada.</p>
      ) : (
        <div className="ps2-grid" data-testid="ps2-grid">
          {entries.map(e => (
            <GameCard key={e.name} entry={e} onBoot={onBoot} onDelete={onDelete} booting={booting === e.name} />
          ))}
        </div>
      )}

      <h2 className="ps2-h2">Catálogo <span className="ps2-count">{total || '…'}</span> <small>juegos state-playable del tracker oficial de Play!</small></h2>
      <input className="ps2-search" type="search" placeholder="Buscar por título o serial (p. ej. Shadow of the Colossus, SLUS-21274)…"
        value={query} onChange={e => setQuery(e.target.value)} data-testid="ps2-search" />
      {query.trim() !== '' && (
        <div className="ps2-results" data-testid="ps2-results">
          {results.length === 0 ? <div className="ps2-noresult">Sin resultados en el tracker.</div> :
            results.map(g => (
              <div className="ps2-result" key={g.serial}>
                <span className="ps2-result-title">{g.title}</span>
                <span className="ps2-result-serial">{g.serial} · {g.region}</span>
                {ownedSerials.has(canonSerial(g.serial)) && <span className="ps2-badge ps2-badge-ok">en tu biblioteca</span>}
                {g.url && <a className="ps2-result-link" href={g.url} target="_blank" rel="noreferrer">tracker ↗</a>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
