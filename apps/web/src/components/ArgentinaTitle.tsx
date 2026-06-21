import { useEffect, useState } from 'react';

export function ArgentinaTitle() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`
        fixed top-3 sm:top-4 md:top-6 left-1/2 -translate-x-1/2
        z-50 select-none pointer-events-none
        text-center
        transition-all duration-1000 ease-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-6'}
      `}
    >
      <h1 className="font-['Playfair_Display',serif] font-black tracking-wide text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl bg-gradient-to-r from-sky-300 via-white to-blue-200 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(125,211,252,0.3)] animate-glow-pulse">
        Argentina
        <br className="sm:hidden" />
        {' '}País Bicontinental
      </h1>
      <div className="mt-1 sm:mt-2 h-px sm:h-0.5 w-1/2 mx-auto bg-gradient-to-r from-transparent via-sky-300/50 to-transparent rounded-full" />
    </div>
  );
}
