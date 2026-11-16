/*
 * Rolagem suave feita em JS (requestAnimationFrame).
 * `behavior: "smooth"` nativo é desligado por alguns navegadores/SO no desktop
 * (ex.: Windows com "Efeitos de animação" off, Firefox com "reduzir movimento"),
 * então a animação é controlada aqui e independe dessa configuração.
 */

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const running = new Map<unknown, () => void>();

function animate(key: unknown, from: number, to: number, apply: (value: number) => void) {
  running.get(key)?.();
  const distance = Math.abs(to - from);
  if (distance < 1) {
    apply(to);
    return;
  }
  const duration = Math.min(800, Math.max(350, distance * 0.6));
  const start = performance.now();
  let frame = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("keydown", stop);
    if (running.get(key) === stop) running.delete(key);
  };
  running.set(key, stop);
  /* O usuário assumindo o controle cancela a animação. */
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("keydown", stop);

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    apply(from + (to - from) * ease(t));
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  frame = requestAnimationFrame(step);
}

/** Rola a página até o elemento (respeita scroll-margin-top, como scrollIntoView block:start). */
export function scrollToElement(el: HTMLElement | null) {
  if (!el) return;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - margin);
  animate("y", window.scrollY, target, (y) => window.scrollTo({ top: y, behavior: "instant" }));
}

/** Rola um container horizontal para centralizar o item. */
export function centerInContainer(container: HTMLElement, item: HTMLElement) {
  const itemBox = item.getBoundingClientRect();
  const boxBox = container.getBoundingClientRect();
  const max = container.scrollWidth - container.clientWidth;
  const target = Math.min(
    max,
    Math.max(
      0,
      container.scrollLeft + (itemBox.left - boxBox.left) - (boxBox.width - itemBox.width) / 2,
    ),
  );
  animate(container, container.scrollLeft, target, (x) => {
    container.scrollLeft = x;
  });
}
