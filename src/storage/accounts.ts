// 账号口令：放 kv（键以 secret. 开头），备份导出默认剔除（原版 webdav.xml 会连口令一起打进备份，Web 版不这样做）。
import { deleteKV, getKV, setKV } from './db';

const key = (name: string) => `secret.account.${name}`;

export const SECRET_PREFIX = 'secret.';

export const getAccountSecret = (name: string) => getKV<string>(key(name));
export const setAccountSecret = (name: string, value: string) => (value ? setKV(key(name), value) : deleteKV(key(name)));
