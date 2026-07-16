import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import AnimatedSplash from '../components/AnimatedSplash';

export default function RootLayout() {
  const [splashVisible, setSplashVisible] = useState(true);

  return (
    <>
      <StatusBar style="light" />
      {splashVisible ? (
        <AnimatedSplash onFinish={() => setSplashVisible(false)} />
      ) : (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#000000' },
            headerTintColor: '#fff',
            contentStyle: { backgroundColor: '#121212' },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="details/[id]" options={{ title: 'Details' }} />
          <Stack.Screen name="player" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="history" options={{ title: 'Watch History' }} />
          <Stack.Screen name="watchlist" options={{ title: 'Watchlist' }} />
          <Stack.Screen name="account" options={{ title: 'Account Details' }} />
          <Stack.Screen name="login-details" options={{ title: 'Login Details' }} />
          <Stack.Screen name="subscription" options={{ title: 'Subscription' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack>
      )}
    </>
  );
}
