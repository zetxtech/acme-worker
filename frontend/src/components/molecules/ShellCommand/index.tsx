import { useMemo, useRef, type UIEvent } from 'react';
import styles from './ShellCommand.module.css';

/**
 * Shell command editor —— 多行 bash 命令，白色外观与普通输入框一致。
 *
 * 实现方式：透明文字的 textarea 叠加在带语法高亮的 pre 之上，
 * 两层使用完全相同的字体、行高、内边距与换行规则，滚动位置实时同步。
 * 不使用外部编辑器依赖，避免额外打包体积。
 */

type TokenKind = 'plain' | 'comment' | 'string' | 'variable' | 'keyword' | 'operator';

interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in',
  'function', 'select', 'time', 'exit', 'return', 'export', 'source', 'local', 'set', 'sudo', 'su',
  'bash', 'sh', 'echo', 'printf', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'ln', 'chmod', 'chown',
  'touch', 'find', 'grep', 'sed', 'awk', 'sleep', 'kill', 'test', 'which', 'cd', 'systemctl',
  'synosystemctl', 'synow3tool', 'synopkg', 'docker', 'nginx', 'service', 'install', 'openssl',
]);

const VARIABLE = /^\$\{[^}\n]*\}|^\$[A-Za-z_][A-Za-z0-9_]*|^\$[@*#?0-9]/;
const WORD = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const BREAK = /[\s#$|&;<>=()\[\]'"]/;

export function tokenizeShell(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === ' ' || char === '\t' || char === '\n') {
      const start = index;
      while (index < source.length && (source[index] === ' ' || source[index] === '\t' || source[index] === '\n')) index += 1;
      tokens.push({ text: source.slice(start, index), kind: 'plain' });
      continue;
    }
    if (char === '#') {
      const start = index;
      while (index < source.length && source[index] !== '\n') index += 1;
      tokens.push({ text: source.slice(start, index), kind: 'comment' });
      continue;
    }
    if (char === "'" || char === '"') {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== char && source[index] !== '\n') {
        if (source[index] === '\\' && char === '"') index += 1;
        index += 1;
      }
      if (index < source.length && source[index] === char) index += 1;
      tokens.push({ text: source.slice(start, index), kind: 'string' });
      continue;
    }
    if (char === '$') {
      const match = VARIABLE.exec(source.slice(index));
      if (match) {
        tokens.push({ text: match[0], kind: 'variable' });
        index += match[0].length;
        continue;
      }
    }
    if ('|&;<>=()[]'.includes(char)) {
      const start = index;
      while (index < source.length && '|&;<>=()[]'.includes(source[index])) index += 1;
      tokens.push({ text: source.slice(start, index), kind: 'operator' });
      continue;
    }
    const word = WORD.exec(source.slice(index));
    if (word) {
      tokens.push({ text: word[0], kind: KEYWORDS.has(word[0]) ? 'keyword' : 'plain' });
      index += word[0].length;
      continue;
    }
    const start = index;
    index += 1;
    while (index < source.length && !BREAK.test(source[index])) index += 1;
    tokens.push({ text: source.slice(start, index), kind: 'plain' });
  }
  return tokens;
}

export interface ShellCommandProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  minLines?: number;
}

export default function ShellCommand({ id, value = '', onChange, onBlur, placeholder, disabled, minLines = 3 }: ShellCommandProps) {
  const overlay = useRef<HTMLPreElement>(null);
  const tokens = useMemo(() => tokenizeShell(value), [value]);
  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const node = overlay.current;
    if (!node) return;
    node.scrollTop = event.currentTarget.scrollTop;
  };
  return <div className={styles.wrap} data-disabled={disabled ? 'true' : undefined} style={{ height: minLines * 20 + 18 }}>
    <pre ref={overlay} className={styles.overlay} aria-hidden="true" data-shell-overlay="true">{value
      ? tokens.map((token, index) => <span key={index} className={styles[token.kind]}>{token.text}</span>)
      : <span className={styles.placeholder}>{placeholder}</span>}{'\n'}</pre>
    <textarea id={id} className={styles.input} value={value} disabled={disabled} spellCheck={false} autoComplete="off"
      autoCapitalize="off" wrap="soft" onChange={(event) => onChange?.(event.target.value)} onScroll={syncScroll} onBlur={onBlur}/>
  </div>;
}
