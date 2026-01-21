"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function JoinMeetingPage() {
  const router = useRouter();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [platform, setPlatform] = useState<"zoom" | "google_meet" | "teams" | "webex">("zoom");
  const [botName, setBotName] = useState("Timtam AI");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // TODO: 環境変数から取得
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";

      const response = await fetch(`${apiUrl}/recall/meetings/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingUrl,
          platform,
          botName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "ボットの参加に失敗しました");
      }

      const data = await response.json();
      router.push(`/meetings/${data.meetingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-xl font-bold text-gray-900">
                Timtam Facilitator
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 transition-colors"
          >
            ← ダッシュボードに戻る
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">
            ボットを会議に参加させる
          </h1>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="meetingUrl"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                会議URL
              </label>
              <input
                type="url"
                id="meetingUrl"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://zoom.us/j/123456789"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Zoom、Google Meet、Microsoft Teams、またはWebexの会議URLを入力
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                プラットフォーム
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: "zoom", label: "Zoom" },
                  { value: "google_meet", label: "Google Meet" },
                  { value: "teams", label: "Microsoft Teams" },
                  { value: "webex", label: "Webex" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-center justify-center px-4 py-3 border rounded-md cursor-pointer transition-colors ${
                      platform === option.value
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="platform"
                      value={option.value}
                      checked={platform === option.value}
                      onChange={(e) =>
                        setPlatform(
                          e.target.value as "zoom" | "google_meet" | "teams" | "webex"
                        )
                      }
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="botName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                ボット名（オプション）
              </label>
              <input
                type="text"
                id="botName"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="Timtam AI"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                会議に表示されるボットの名前
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !meetingUrl}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? "参加中..." : "ボットを参加させる"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
