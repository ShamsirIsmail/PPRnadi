import React from 'react';
import LoginForm from './LoginForm';

export const metadata = {
  title: 'Log Masuk | PPR NADI',
  description: 'Sistem Pengurusan & Ketahanan Komuniti PPR NADI',
};

export default async function LoginPage() {
  // Explicit server environment flag for staging/demo environments
  const isDemoEnabled = process.env.ENABLE_DEMO_LOGIN === 'true';

  return <LoginForm isDemoEnabled={isDemoEnabled} />;
}
