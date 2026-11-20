// ข้อมูลที่ทุกหน้าใช้ร่วมกัน (ตั้งค่า โต๊ะ เมนู) — โหลดครั้งแรกและอัปเดตอัตโนมัติเมื่อมีการเปลี่ยนแปลง
import { api, onTopic, emit } from './lib.js';

export const store = {
  settings: {},
  tables: [],
  categories: [],
  menu: [],
  lowStock: 0,
  lanUrls: [],
};

export const flag = (key) => store.settings[key] === '1';

export async function loadStore() {
  Object.assign(store, await api.get('/bootstrap'));
}

export function categoryName(id) {
  return store.categories.find((c) => c.id === id)?.name || 'ไม่มีหมวด';
}

// เมื่อเซิร์ฟเวอร์แจ้งว่าข้อมูลเปลี่ยน ให้โหลดใหม่ แล้วแจ้งหน้าที่ฟัง "store:*"
export function wireStore() {
  onTopic('menu', async () => {
    const [categories, menu] = await Promise.all([api.get('/categories'), api.get('/menu')]);
    store.categories = categories;
    store.menu = menu;
    emit('store:menu');
  });
  onTopic('tables', async () => {
    store.tables = await api.get('/tables');
    emit('store:tables');
  });
  onTopic('settings', async () => {
    store.settings = await api.get('/settings');
    emit('store:settings');
  });
  onTopic('stock', async () => {
    const list = await api.get('/ingredients');
    store.lowStock = list.filter((i) => i.quantity <= i.min_quantity).length;
    emit('store:stock');
  });
}
