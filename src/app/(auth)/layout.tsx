import React from 'react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col justify-center items-center py-2 px-0 sm:py-6 sm:px-4 lg:py-8 lg:px-8">
      {children}
    </div>
  );
}
