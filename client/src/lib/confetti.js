/**
 * Confetti burst — fires when the learner achieves the lesson exemplar.
 */
export function launchConfetti() {
  const colors = ['#fcd34d', '#60a5fa', '#f472b6', '#34d399', '#a78bfa'];
  const count = 60;
  const container = document.getElementById('main-content') || document.body;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.setProperty('--x', `${(Math.random() - 0.5) * 300}px`);
    el.style.setProperty('--y', `${-Math.random() * 400 - 100}px`);
    el.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    el.style.setProperty('--d', `${0.5 + Math.random() * 0.8}s`);
    el.style.backgroundColor = colors[i % colors.length];
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.top = '60%';
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}
