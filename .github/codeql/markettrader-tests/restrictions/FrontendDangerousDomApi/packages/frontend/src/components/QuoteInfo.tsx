declare const html: string;
declare const props: { rel?: string };
declare const dynamicRel: string;
declare const el: HTMLElement;

export function QuoteInfo() {
  el.innerHTML = html; // BAD
  el.outerHTML = html; // BAD
  el.insertAdjacentHTML('beforeend', html); // BAD
  document.write(html); // BAD
  eval('1 + 1'); // BAD
  const f = new Function('return 1'); // BAD
  el.textContent = html; // OK
  el.innerHTML += html; // BAD: compound assignment
  el['innerHTML'] = html; // BAD: computed property
  const shape = { innerHTML: html }; // OK: an object literal writes no DOM
  const g = Function('return 1'); // BAD: Function called without new
  void [shape, g];
  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: html }} /> {/* BAD */}
      <a href="https://x" target="_blank">x</a> {/* BAD: no rel */}
      <a href="https://x" target="_blank" rel="external">x</a> {/* BAD: rel lacks noopener */}
      <a href="https://x" target="_blank" rel="noopener noreferrer">ok</a> {/* OK */}
      <a href="https://x" target="_blank" rel="noreferrer">ok</a> {/* OK: noreferrer implies noopener */}
      <a href="https://x" target="_blank" {...props}>ok</a> {/* OK: spread may carry rel */}
      <a href="https://x" target="_blank" rel={dynamicRel}>ok</a> {/* OK: not judged */}
      <a href="https://x" target="_self">ok</a> {/* OK */}
      <a href="https://x" target={'_blank'}>x</a> {/* BAD: expression-container target, no rel */}
      <a
        href="https://x"
        target="_blank"
        rel="noopener"
      >
        ok
      </a> {/* OK: multi-line, like QuoteInfo.tsx:207 */}
      {String(f)}
    </div>
  );
}
