"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface Meeting {
  meetingId: string;
  platform: string;
  status: string;
  meetingCode?: string;
  createdAt: number;
  recallBot?: {
    meetingUrl: string;
    platform: string;
    status: string;
  };
}

export default function DashboardPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: 実際のAPI呼び出しに置き換え
    // For now, mock data
    setLoading(false);
    setMeetings([]);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">
                Timtam Facilitator
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/meetings/join"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                新しい会議に参加
              </Link>
              <Link
                href="/config"
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors"
              >
                Grasp設定
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            アクティブな会議
          </h2>
          <p className="text-gray-600">
            現在進行中の会議とボットの状態を確認できる
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-2 text-gray-600">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-red-800">{error}</p>
          </div>
        ) : meetings.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <p className="text-gray-600 mb-4">
              アクティブな会議はありません
            </p>
            <Link
              href="/meetings/join"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              新しい会議に参加
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {meetings.map((meeting) => (
              <div
                key={meeting.meetingId}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        meeting.status === "active"
                          ? "bg-green-500"
                          : "bg-gray-400"
                      }`}
                    ></div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        Meeting ID: {meeting.meetingId}
                      </h3>
                      <p className="text-sm text-gray-600">
                        Platform: {meeting.platform} | Code:{" "}
                        {meeting.meetingCode || "N/A"}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/meetings/detail?id=${meeting.meetingId}`}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    詳細を見る
                  </Link>
                </div>
                {meeting.recallBot && (
                  <div className="text-sm text-gray-600">
                    <p>URL: {meeting.recallBot.meetingUrl}</p>
                    <p>Status: {meeting.recallBot.status}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
