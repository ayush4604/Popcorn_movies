import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

export default function SubscriptionScreen() {
  const [account, setAccount] = useState<any>(null);

  useEffect(() => {
    loadAccount();
  }, []);

  const loadAccount = async () => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_account');
      if (stored) {
        setAccount(JSON.parse(stored));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpgrade = async () => {
    Linking.openURL('https://t.me/+lGFcHVz_gy0wZThl');
    if (account) {
      const updated = { ...account, tier: 'premium' };
      await AsyncStorage.setItem('popcorn_account', JSON.stringify(updated));
      setAccount(updated);
    }
  };

  if (!account) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Current Plan</Text>
        <Text style={[styles.tier, account.tier === 'premium' ? styles.premium : styles.guest]}>
          {account.tier.toUpperCase()}
        </Text>
        
        {account.tier === 'guest' && (
          <Text style={styles.desc}>
            You are currently on a limited Guest account. Upgrade to Premium to unlock all content forever.
          </Text>
        )}
      </View>

      {account.tier === 'guest' && (
        <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade}>
          <Text style={styles.upgradeText}>Upgrade to Premium for FREE</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  card: {
    backgroundColor: '#1e1e1e',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: '#aaa',
    fontSize: 16,
    marginBottom: 8,
  },
  tier: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  premium: {
    color: '#ffd700',
  },
  guest: {
    color: '#fff',
  },
  desc: {
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 22,
  },
  upgradeBtn: {
    backgroundColor: '#0088cc',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  upgradeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  }
});
