import fs from 'node:fs';
// 从 app.js 中提取 authView 函数，配合桩函数验证四种模式的渲染输出
const src = fs.readFileSync('app.js', 'utf8');
const m = src.match(/^function authView\(\)\{[\s\S]*?^\}/m);
if (!m) { console.error('未找到 authView 函数'); process.exit(1); }

const stubs = `
const localStorage = { getItem: () => '', setItem: () => {}, removeItem: () => {} };
function svgIcon(name, size) { return '<svg data-icon="' + name + '"></svg>'; }
function esc(x) { return String(x == null ? '' : x); }
function brandLogo(n) { return '<b class="brand"></b>'; }
`;
const m2 = src.match(/^function legalModalHtml\(\)\{[\s\S]*?^\}/m);
if (!m2) { console.error('未找到 legalModalHtml 函数'); process.exit(1); }

// authView 内部调用 legalModalHtml，两个函数需在同一作用域；S 通过 setter 注入
const factory = new Function(stubs + 'let S; ' + m[0] + '\n' + m2[0] + '; return { view: (s) => { S = s; return authView(); }, legal: (s) => { S = s; return legalModalHtml(); } };');
const api = factory();
const makeAuthView = (s) => api.view(s);
const makeLegal = (s) => api.legal(s);

function check(label, html, mustHave = [], mustNotHave = []) {
  let pass = true;
  for (const s of mustHave) if (!html.includes(s)) { pass = false; console.error(`  ✗ 缺少: ${s}`); }
  for (const s of mustNotHave) if (html.includes(s)) { pass = false; console.error(`  ✗ 不应出现: ${s}`); }
  console.log(`${pass ? '✓' : '✗'} ${label}`);
  return pass;
}

const baseAuth = { mode: 'login', message: '', messageType: 'error', submitting: false, showPwd: false, showConfirm: false, remember: false, strength: 0, resetStep: 1, resetAccount: '' };
const mk = (over = {}) => makeAuthView({ ui: { legal: null }, auth: { ...baseAuth, ...over } });
let all = true;

all &= check('登录模式', mk(),
  ['id="auth-account"', 'id="auth-password"', 'id="forgot-password"', 'id="auth-remember"', 'auth-tabs', '登录并进入工作台'],
  ['id="auth-code"', 'id="auth-confirm"', 'auth-agree', 'auth-reset-hint']);

all &= check('注册模式', mk({ mode: 'register', showPwd: true }),
  ['id="auth-name"', 'id="auth-confirm"', 'auth-agree', 'pwd-strength', 'id="auth-account"', '注册并开始使用'],
  ['id="auth-code"', 'id="forgot-password"']);

all &= check('重置步骤1', mk({ mode: 'reset' }),
  ['重置密码', 'id="auth-account"', '获取验证码', '返回登录'],
  ['id="auth-password"', 'id="auth-code"', 'auth-tabs', 'id="auth-remember"', 'auth-agree']);

all &= check('重置步骤2', mk({ mode: 'reset', resetStep: 2, resetAccount: '13911112222' }),
  ['验证码已发送至账号 <b>13911112222</b>', 'id="auth-code"', 'id="auth-password"', '新密码', 'id="auth-confirm"', '确认重置'],
  ['id="auth-account"', 'id="auth-name"', 'auth-tabs']);

all &= check('成功消息渲染', mk({ mode: 'reset', resetStep: 2, resetAccount: '13911112222', message: '演示模式：本次验证码为 123456', messageType: 'success' }),
  ['auth-message success', '123456'], ['field-error']);

// ---- 法务弹窗 ----
const mkUi = (legal) => makeLegal({ ui: { legal } });
all &= check('弹窗-关闭态', mkUi(null), [], ['legal-overlay']);

all &= check('弹窗-服务条款', mkUi('terms'),
  ['legal-overlay', '服务条款', '一、服务说明', '五、服务变更', '我知道了', 'data-legal-close'], []);
all &= check('弹窗-隐私说明', mkUi('privacy'),
  ['六、您的权利', '四、模型与语音调用', 'localStorage'], []);
all &= check('弹窗-帮助中心', mkUi('help'),
  ['忘记密码怎么办', '评估报告可信吗', '联系我们'], []);

// 登录页页脚与注册同意处的弹窗入口
all &= check('登录页页脚弹窗入口', mk(),
  ['data-legal="terms"', 'data-legal="privacy"', 'data-legal="help"', 'auth-footer-links'], ['javascript:;']);
all &= check('注册同意处可点击条款', mk({ mode: 'register' }),
  ['data-legal="terms"', 'data-legal="privacy"', 'auth-agree'], ['javascript:;']);

console.log(all ? '\n全部通过' : '\n存在失败项');
process.exit(all ? 0 : 1);
