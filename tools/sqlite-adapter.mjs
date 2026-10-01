// Local/test adapter for D1's atomic batch; no async gaps inside SQLite's transaction.
export function d1Adapter(db){
 const prepare=sql=>{let args=[];const run=()=>({meta:db.prepare(sql).run(...args)});return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return run();},_run:run};};
 return {prepare,async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s._run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
