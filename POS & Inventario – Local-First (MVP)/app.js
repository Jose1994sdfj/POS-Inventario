/******************** UTILIDADES *************************/
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const fmt = n => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number.isFinite(n)?n:0);
const todayKey = (d=new Date()) => d.toISOString().slice(0,10);

/******************** ALMACENAMIENTO (IndexedDB) *********/
const DB_NAME = 'posdb-v1';
const DB_VERSION = 1;
let db;
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('productos')){
        const s = db.createObjectStore('productos',{keyPath:'sku'});
        s.createIndex('nombre','nombre',{unique:false});
      }
      if(!db.objectStoreNames.contains('ventas')){
        const s = db.createObjectStore('ventas',{keyPath:'id'});
        s.createIndex('fecha','fecha',{unique:false});
      }
      if(!db.objectStoreNames.contains('config')){
        db.createObjectStore('config',{keyPath:'key'});
      }
    };
    req.onsuccess = ()=>{db=req.result; resolve(db)};
    req.onerror = ()=>reject(req.error);
  });
}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
const idb = {
  async put(store, val){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error)})},
  async get(store, key){return new Promise((res,rej)=>{const r=tx(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error)})},
  async all(store){return new Promise((res,rej)=>{const r=tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error)})},
  async del(store, key){return new Promise((res,rej)=>{const r=tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error)})}
};

/******************** ROUTER SIMPLE **********************/
const routes = ['dashboard','productos','ventas','reportes','ajustes'];
function show(route){
  routes.forEach(r=>{ $('#view-'+r).classList.add('hidden'); });
  $('#view-'+route).classList.remove('hidden');
  $$('.navitem').forEach(n=>n.classList.toggle('active', n.dataset.route===route));
  location.hash = route;
  if(route==='dashboard') renderDashboard();
  if(route==='productos') renderProductos();
  if(route==='ventas') renderVentas();
  if(route==='reportes') renderReportes();
  if(route==='ajustes') renderAjustes();
}

/******************** DOM READY **************************/
await openDB();
// Seed demo (una sola vez)
if(!(await idb.get('config','seeded'))){
  const demo = [
    {sku:'A001', nombre:'Café 250g', precio:89, stock:20, min:5},
    {sku:'A002', nombre:'Té Verde', precio:69, stock:35, min:8},
    {sku:'A003', nombre:'Galletas Artesanales', precio:55, stock:12, min:4}
  ];
  for(const p of demo) await idb.put('productos', p);
  await idb.put('config',{key:'seeded', value:true});
  await idb.put('config',{key:'plan', value:'free'});
  await idb.put('config',{key:'tienda', value:{nombre:'Mi Tienda', rfc:'', iva:16}});
}

// Navegación
$$('.navitem').forEach(n=>n.addEventListener('click',()=>show(n.dataset.route)));
window.addEventListener('hashchange',()=>{
  const r = location.hash.replace('#','');
  if(routes.includes(r)) show(r); else show('dashboard');
});

// Acciones globales
$('#btn-export').addEventListener('click', exportCSV);
$('#btn-backup').addEventListener('click', downloadBackup);
$('#btn-add-sale').addEventListener('click',()=>show('ventas'));

// Iniciar vista
const start = location.hash.replace('#','') || 'dashboard';
show(routes.includes(start)?start:'dashboard');

/******************** LÓGICA: PRODUCTOS *******************/
async function renderProductos(list){
  const productos = list || await idb.all('productos');
  const wrap = $('#productos-table');
  if(!productos.length){ wrap.innerHTML = `<div class="empty">Aún no hay productos</div>`; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>SKU</th><th>Nombre</th><th>Precio</th><th>Stock</th><th>Mín.</th><th></th></tr></thead>
      <tbody>
        ${productos.map(p=>`
          <tr>
            <td>${p.sku}</td>
            <td>${p.nombre}</td>
            <td>${fmt(p.precio)}</td>
            <td>${p.stock ?? 0}</td>
            <td>${p.min ?? 0}</td>
            <td><button data-del="${p.sku}" class="danger">Eliminar</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('button[data-del]').forEach(b=>b.addEventListener('click', async ()=>{
    await idb.del('productos', b.dataset.del);
    renderProductos(); updateMetrics();
  }));
}

$('#p-guardar').addEventListener('click', async ()=>{
  const sku = $('#p-sku').value.trim();
  const nombre = $('#p-nombre').value.trim();
  const precio = parseFloat($('#p-precio').value);
  const stock = parseInt($('#p-stock').value);
  const min = parseInt($('#p-min').value);

  if(!sku || !nombre || !Number.isFinite(precio)){ $('#p-msg').textContent='Completa SKU, nombre y precio'; return; }
  if(precio < 0){ $('#p-msg').textContent='Precio inválido'; return; }

  await idb.put('productos',{
    sku,
    nombre,
    precio: Number.isFinite(precio)?precio:0,
    stock: Number.isFinite(stock)?Math.max(0,stock):0,
    min: Number.isFinite(min)?Math.max(0,min):0
  });
  $('#p-msg').textContent='Guardado'; setTimeout(()=>$('#p-msg').textContent='',1200);
  ['#p-sku','#p-nombre','#p-precio','#p-stock','#p-min'].forEach(sel=>$(sel).value='');
  renderProductos(); updateMetrics();
});

$('#p-buscar').addEventListener('input', async (e)=>{
  const q = e.target.value.toLowerCase();
  const all = await idb.all('productos');
  const filtered = all.filter(p=> p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  renderProductos(filtered);
});

$('#p-borrar-todo').addEventListener('click', async ()=>{
  if(!confirm('¿Eliminar todos los productos?')) return;
  const all = await idb.all('productos');
  for(const p of all){ await idb.del('productos', p.sku); }
  renderProductos(); updateMetrics();
});

/******************** LÓGICA: VENTAS **********************/
const venta = [];
function renderVentaActual(){
  const tbody = $('#venta-actual tbody');
  tbody.innerHTML = venta.map((i,idx)=>`
    <tr>
      <td>${i.sku}</td>
      <td>${i.nombre}</td>
      <td>${i.cant}</td>
      <td>${fmt(i.precio)}</td>
      <td>${fmt(i.precio*i.cant)}</td>
      <td><button data-rm="${idx}" class="danger">Quitar</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('button[data-rm]').forEach(b=>b.addEventListener('click',()=>{
    venta.splice(parseInt(b.dataset.rm),1);
    renderVentaActual(); calcTotales();
  }));
  calcTotales();
}

function calcTotales(){
  const sub = venta.reduce((a,i)=>a+i.precio*i.cant,0);
  idb.get('config','tienda').then(c=>{
    const ivaRate = (c?.value?.iva ?? 16)/100;
    const iva = +(sub*ivaRate).toFixed(2);
    const total = sub + iva;
    $('#v-sub').textContent = fmt(sub);
    $('#v-iva').textContent = fmt(iva);
    $('#v-total').textContent = fmt(total);
  });
}

$('#v-agregar').addEventListener('click', async ()=>{
  const sku = $('#v-sku').value.trim();
  const cantRaw = parseInt($('#v-cant').value);
  const cant = Number.isFinite(cantRaw) ? cantRaw : 1;
  const p = await idb.get('productos', sku);
  if(!p){ $('#v-msg').textContent='SKU no encontrado'; return; }
  if(cant<=0){ $('#v-msg').textContent='Cantidad inválida'; return; }
  if((p.stock ?? 0) < cant){ $('#v-msg').textContent='Stock insuficiente'; return; }
  venta.push({sku:p.sku, nombre:p.nombre, precio:p.precio, cant});
  $('#v-sku').value=''; $('#v-cant').value=1; $('#v-msg').textContent='Agregado'; setTimeout(()=>$('#v-msg').textContent='',800);
  renderVentaActual();
});

$('#v-cobrar').addEventListener('click', async ()=>{
  if(!venta.length) return;
  // Actualizar inventario
  for(const i of venta){
    const p = await idb.get('productos', i.sku);
    p.stock = (p.stock||0) - i.cant;
    await idb.put('productos', p);
  }
  // Guardar venta
  const id = crypto.randomUUID();
  const fecha = new Date().toISOString();
  const total = venta.reduce((a,i)=>a+i.precio*i.cant,0);
  await idb.put('ventas',{id, fecha, items:[...venta], total});
  venta.length = 0;
  renderVentaActual();
  renderVentas();
  updateMetrics();
  alert('Venta registrada');
});

async function renderVentas(){
  // historial
  const ventas = (await idb.all('ventas')).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const wrap = $('#ventas-historial');
  if(!ventas.length){ wrap.innerHTML = `<div class="empty">Sin ventas registradas</div>`; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Productos</th><th>Total</th></tr></thead>
      <tbody>
        ${ventas.map(v=>`<tr><td>${new Date(v.fecha).toLocaleString('es-MX')}</td><td>${v.items.length}</td><td>${fmt(v.items.reduce((a,i)=>a+i.precio*i.cant,0))}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

/******************** DASHBOARD & REPORTES ***************/
let chart7, chartReport;
async function updateMetrics(){
  const ventas = await idb.all('ventas');
  const productos = await idb.all('productos');
  const hoy = todayKey();
  const ventasHoy = ventas.filter(v=>v.fecha.slice(0,10)===hoy);
  const ingresosHoy = ventasHoy.reduce((a,v)=>a+v.items.reduce((s,i)=>s+i.precio*i.cant,0),0);
  $('#m-ingresos-hoy').textContent = fmt(ingresosHoy);
  $('#m-ventas-hoy').textContent = ventasHoy.length;
  $('#m-inventario').textContent = productos.reduce((a,p)=>a+(p.stock||0),0);
  $('#m-bajo-stock').textContent = productos.filter(p=>(p.stock||0) <= (p.min||0)).length;
}

async function renderDashboard(){
  await updateMetrics();
  const ventas = await idb.all('ventas');
  const days = [...Array(7)].map((_,i)=>{
    const d = new Date(); d.setDate(d.getDate()- (6-i));
    const k = d.toISOString().slice(0,10);
    const total = ventas.filter(v=>v.fecha.slice(0,10)===k).reduce((a,v)=>a+v.items.reduce((s,i)=>s+i.precio*i.cant,0),0);
    return {label: d.toLocaleDateString('es-MX',{weekday:'short'}), total};
  });
  const ctx = $('#chart7').getContext('2d');
  chart7?.destroy();
  chart7 = new Chart(ctx,{type:'line', data:{labels:days.map(d=>d.label), datasets:[{label:'MXN', data:days.map(d=>d.total)}]}});
}

async function renderReportes(){
  const ventas = await idb.all('ventas');
  const counts = {};
  ventas.forEach(v=>v.items.forEach(i=>{counts[i.nombre]=(counts[i.nombre]||0)+i.cant;}));
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  $('#r-top').innerHTML = top.length ? top.map(([n,c])=>`<div class="row"><span>${n}</span><span class="right badge">${c} vendidos</span></div>`).join('') : '<div class="empty">Aún no hay datos</div>';

  // Ventas por día (últimos 14)
  const days = [...Array(14)].map((_,i)=>{
    const d = new Date(); d.setDate(d.getDate()- (13-i));
    const k = d.toISOString().slice(0,10);
    const total = ventas.filter(v=>v.fecha.slice(0,10)===k).reduce((a,v)=>a+v.items.reduce((s,i)=>s+i.precio*i.cant,0),0);
    return {label: d.toLocaleDateString('es-MX',{month:'short', day:'2-digit'}), total};
  });
  const ctx = $('#chartReport').getContext('2d');
  chartReport?.destroy();
  chartReport = new Chart(ctx,{type:'bar', data:{labels:days.map(d=>d.label), datasets:[{label:'Ventas', data:days.map(d=>d.total)}]}});
}

/******************** EXPORT/IMPORT **********************/
function csvEscape(val){
  const s = String(val ?? '');
  if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
async function exportCSV(){
  const productos = await idb.all('productos');
  const ventas = await idb.all('ventas');
  const csvP = ['sku,nombre,precio,stock,min', ...productos.map(p=>[
    csvEscape(p.sku), csvEscape(p.nombre), p.precio, p.stock ?? 0, p.min ?? 0
  ].join(','))].join('\n');
  const csvV = ['id,fecha,total,items', ...ventas.map(v=>[
    csvEscape(v.id), v.fecha, v.items.reduce((s,i)=>s+i.precio*i.cant,0), v.items.length
  ].join(','))].join('\n');
  const blob = new Blob([`PRODUCTOS\n${csvP}\n\nVENTAS\n${csvV}`],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`export-pos-${todayKey()}.csv`; a.click();
}

async function downloadBackup(){
  const data = {
    productos: await idb.all('productos'),
    ventas: await idb.all('ventas'),
    config: await idb.all('config')
  };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`backup-pos-${todayKey()}.json`; a.click();
}

$('#aj-import').addEventListener('click',()=>$('#aj-file').click());
$('#aj-file').addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const jsonText = await file.text();
  let json;
  try{ json = JSON.parse(jsonText); }catch{ alert('Archivo inválido'); return; }
  for(const p of (json.productos||[])) await idb.put('productos', p);
  for(const v of (json.ventas||[])) await idb.put('ventas', v);
  for(const c of (json.config||[])) await idb.put('config', c);
  alert('Backup importado');
  renderProductos(); renderVentas(); renderDashboard();
});

/******************** AJUSTES ****************************/
async function renderAjustes(){
  const plan = await idb.get('config','plan');
  $('#aj-plan').value = plan?.value || 'free';
  $('#badge-plan').textContent = (plan?.value||'free').toUpperCase();
  const t = await idb.get('config','tienda');
  $('#tienda-nombre').value = t?.value?.nombre || '';
  $('#tienda-rfc').value = t?.value?.rfc || '';
  $('#tienda-iva').value = t?.value?.iva ?? 16;
}

$('#aj-plan').addEventListener('change', async (e)=>{
  await idb.put('config',{key:'plan', value:e.target.value});
  $('#badge-plan').textContent = e.target.value.toUpperCase();
  alert('Plan actualizado');
});

$('#tienda-guardar').addEventListener('click', async ()=>{
  const nombre = $('#tienda-nombre').value.trim();
  const rfc = $('#tienda-rfc').value.trim();
  const ivaVal = parseFloat($('#tienda-iva').value);
  const iva = Number.isFinite(ivaVal) ? Math.max(0,ivaVal) : 16;
  await idb.put('config',{key:'tienda', value:{nombre,rfc,iva}});
  alert('Datos guardados');
  calcTotales();
});

/******************** PWA (opcional) *********************/
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}
