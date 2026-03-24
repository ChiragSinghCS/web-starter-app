"use client"

import { CheckCircle2, Target, Sparkles } from "lucide-react"

interface ScorecardData {
  score: number
  strongPoint: string
  improvement: string
}

interface ScorecardDashboardProps {
  data: ScorecardData
}

function getScoreColor(score: number) {
  if (score >= 8) return { ring: "#22c55e", glow: "rgba(34, 197, 94, 0.4)" }
  if (score >= 5) return { ring: "#f59e0b", glow: "rgba(245, 158, 11, 0.4)" }
  return { ring: "#ef4444", glow: "rgba(239, 68, 68, 0.4)" }
}

function CircularProgress({ score }: { score: number }) {
  const { ring, glow } = getScoreColor(score)
  const percentage = (score / 10) * 100
  const circumference = 2 * Math.PI * 120
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="relative flex items-center justify-center">
      <svg
        className="transform -rotate-90"
        width="280"
        height="280"
        viewBox="0 0 280 280"
      >
        {/* Background circle */}
        <circle
          cx="140"
          cy="140"
          r="120"
          stroke="currentColor"
          strokeWidth="12"
          fill="none"
          className="text-slate-700/50"
        />
        {/* Progress circle */}
        <circle
          cx="140"
          cy="140"
          r="120"
          stroke={ring}
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            filter: `drop-shadow(0 0 12px ${glow})`,
            transition: "stroke-dashoffset 1s ease-out",
          }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-6xl font-bold tracking-tight"
          style={{ color: ring }}
        >
          {score}
        </span>
        <span className="text-slate-400 text-lg font-medium">/ 10</span>
      </div>
    </div>
  )
}

export default function ScorecardDashboard({ data }: ScorecardDashboardProps) {
  const { score, strongPoint, improvement } = data

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-8 flex items-center justify-center">
      <div className="w-full max-w-3xl animate-[fadeSlideUp_0.6s_ease-out_forwards] opacity-0">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-slate-400" />
            <span className="text-slate-400 text-sm font-medium uppercase tracking-widest">
              AI Assessment
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-50 tracking-tight">
            Interview Evaluation
          </h1>
          <p className="text-slate-400 mt-2 text-balance">
            Your technical interview performance analysis
          </p>
        </div>

        {/* Score Section */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-8 mb-6 flex flex-col items-center backdrop-blur-sm">
          <CircularProgress score={score} />
          <p className="text-slate-300 mt-6 text-center font-medium">
            {score >= 8
              ? "Excellent Performance"
              : score >= 5
                ? "Good Effort"
                : "Room for Improvement"}
          </p>
        </div>

        {/* Feedback Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Strength Card */}
          <div
            className="bg-slate-800/50 border border-emerald-500/30 rounded-xl p-6 backdrop-blur-sm relative overflow-hidden group hover:border-emerald-500/50 transition-colors duration-300"
            style={{
              boxShadow: "0 0 30px -10px rgba(34, 197, 94, 0.2)",
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-50">
                  Key Strength
                </h3>
              </div>
              <p className="text-slate-300 leading-relaxed">{strongPoint}</p>
            </div>
          </div>

          {/* Improvement Card */}
          <div
            className="bg-slate-800/50 border border-blue-500/30 rounded-xl p-6 backdrop-blur-sm relative overflow-hidden group hover:border-blue-500/50 transition-colors duration-300"
            style={{
              boxShadow: "0 0 30px -10px rgba(59, 130, 246, 0.2)",
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Target className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-50">
                  Area for Growth
                </h3>
              </div>
              <p className="text-slate-300 leading-relaxed">{improvement}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
