import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

// 正式產物使用獨立路徑，保留 dist/ 內既有的 GUI 實驗檔。
export default defineConfig({ plugins: [gui({ entry: "gui.tsx", outFile: "build/gui.cjs" })] })
