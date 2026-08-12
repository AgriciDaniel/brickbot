import { NokiaStage } from "@/components/nokia-stage"
import { GradientBackground } from "@/components/gradient-background"

export default function Home() {
  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#1a1a1a] flex items-center justify-center">
      <GradientBackground />
      <NokiaStage />
    </main>
  )
}
