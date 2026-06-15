/**
 * Mango × QVAC — Lightweight Markdown renderer
 * Handles code blocks, bold/italic/inline-code, headings, bullet/numbered lists.
 */
import React from 'react';
import { Text, View, Platform } from 'react-native';
import type { ThemeColors } from '../theme';

interface Props {
  text: string;
  style?: any;
  theme: ThemeColors;
}

function renderInline(text: string) {
  const parts: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] = [];
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\*(.+?)\*)/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    if (m[1]) parts.push({ text: m[2], bold: true });
    else if (m[3]) parts.push({ text: m[4], code: true });
    else if (m[5]) parts.push({ text: m[6], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  if (parts.length === 0) parts.push({ text });
  return parts.map((p, i) =>
    p.bold ? <Text key={i} style={{ fontWeight: '700' }}>{p.text}</Text>
    : p.italic ? <Text key={i} style={{ fontStyle: 'italic' }}>{p.text}</Text>
    : p.code ? <Text key={i} style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, backgroundColor: 'rgba(128,128,128,0.15)', paddingHorizontal: 3, borderRadius: 3 }}>{p.text}</Text>
    : <Text key={i}>{p.text}</Text>,
  );
}

export const MarkdownText: React.FC<Props> = React.memo(({ text, style, theme }) => {
  const blocks = text.split(/\n\n+/);

  return (
    <View>
      {blocks.map((block, bi) => {
        // Code block
        if (block.startsWith('```')) {
          const lines = block.split('\n');
          const lang = lines[0].replace('```', '').trim();
          const code = lines.slice(1, lines.length > 1 && lines[lines.length - 1] === '```' ? -1 : undefined).join('\n').replace(/```\s*$/, '');
          return (
            <View key={bi} style={{ borderRadius: 8, padding: 10, marginVertical: 4, borderWidth: 1, backgroundColor: theme.codeBg, borderColor: theme.codeBorder }}>
              {lang ? <Text style={{ fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', color: theme.mutedText }}>{lang}</Text> : null}
              <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 18, color: theme.textPrimary }} selectable>{code}</Text>
            </View>
          );
        }

        const lines = block.split('\n');
        return (
          <View key={bi} style={{ marginBottom: 2 }}>
            {lines.map((line, li) => {
              if (/^[-*•]\s/.test(line)) {
                return (
                  <View key={li} style={{ flexDirection: 'row', gap: 6, paddingVertical: 1 }}>
                    <Text style={{ width: 14, fontSize: 14, color: theme.accent }}>•</Text>
                    <Text style={[style, { flex: 1, fontSize: 15, lineHeight: 22, color: theme.textPrimary }]}>{renderInline(line.replace(/^[-*•]\s*/, ''))}</Text>
                  </View>
                );
              }
              if (/^\d+\.\s/.test(line)) {
                const num = line.match(/^(\d+)\./)?.[1] || '1';
                return (
                  <View key={li} style={{ flexDirection: 'row', gap: 6, paddingVertical: 1 }}>
                    <Text style={{ width: 20, fontSize: 13, fontWeight: '600', color: theme.accent }}>{num}.</Text>
                    <Text style={[style, { flex: 1, fontSize: 15, lineHeight: 22, color: theme.textPrimary }]}>{renderInline(line.replace(/^\d+\.\s*/, ''))}</Text>
                  </View>
                );
              }
              if (/^#{1,3}\s/.test(line)) {
                const level = (line.match(/^(#{1,3})/)?.[1] || '#').length;
                const sizes = [20, 17, 15];
                return <Text key={li} style={{ fontSize: sizes[level - 1] || 15, fontWeight: '700', color: theme.textPrimary, marginTop: 4 }}>{line.replace(/^#{1,3}\s*/, '')}</Text>;
              }
              return <Text key={li} style={[style, { color: theme.textPrimary }]}>{renderInline(line)}</Text>;
            })}
          </View>
        );
      })}
    </View>
  );
});
