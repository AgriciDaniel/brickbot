"use client"

export function GradientBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Gradient Bubbles */}
      <div className="absolute inset-0">
        {/* Orange/Red bubble - top left */}
        <div className="absolute top-0 left-0 w-[600px] h-[600px] rounded-full bg-gradient-radial from-orange-500/40 via-red-500/30 to-transparent blur-[120px] animate-float-slow" />

        {/* White/Gray bubble - center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-gradient-radial from-white/30 via-gray-300/20 to-transparent blur-[100px] animate-float-medium" />

        {/* Teal/Dark green bubble - bottom right */}
        <div className="absolute bottom-0 right-0 w-[700px] h-[700px] rounded-full bg-gradient-radial from-teal-600/40 via-emerald-800/30 to-transparent blur-[130px] animate-float-fast" />

        {/* Additional ambient bubbles */}
        <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-gradient-radial from-purple-500/20 via-pink-500/15 to-transparent blur-[90px] animate-float-slow" />

        <div className="absolute bottom-1/4 left-1/4 w-[450px] h-[450px] rounded-full bg-gradient-radial from-blue-500/25 via-cyan-600/20 to-transparent blur-[110px] animate-float-medium" />
      </div>

      {/* Noise + Blur Overlay */}
      <div className="absolute inset-0 bg-noise opacity-40 mix-blend-overlay" />
      <div className="absolute inset-0 backdrop-blur-[2px]" />

      {/* Dark overlay to darken the background */}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  )
}
