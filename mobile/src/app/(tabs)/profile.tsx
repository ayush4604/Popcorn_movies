import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Image } from 'react-native';
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

interface UserAccount {
  id: string;
  username: string;
  tier: 'guest' | 'premium';
  avatar: string;
}

export default function ProfileScreen() {
  const [account, setAccount] = useState<UserAccount | null>(null);
  const router = useRouter();

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

  const menuItems = [
    { title: 'Watch History', icon: 'time-outline', route: '/history' },
    { title: 'Watchlist', icon: 'bookmark-outline', route: '/watchlist' },
    { title: 'Account Details', icon: 'person-outline', route: '/account' },
    { title: 'Login Details', icon: 'lock-closed-outline', route: '/login-details' },
    { title: 'Subscription', icon: 'card-outline', route: '/subscription' },
    { title: 'Settings', icon: 'settings-outline', route: '/settings' },
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>My Profile</Text>
      
      {account && (
        <View style={styles.profileCard}>
          <Image source={{ uri: account.avatar }} style={styles.avatar} />
          <View style={styles.profileInfo}>
            <Text style={styles.username}>{account.username}</Text>
            <View style={[styles.badge, account.tier === 'premium' ? styles.premiumBadge : styles.guestBadge]}>
              <Text style={styles.badgeText}>{account.tier.toUpperCase()}</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.menuContainer}>
        {menuItems.map((item, index) => (
          <TouchableOpacity 
            key={index} 
            style={styles.menuItem}
            onPress={() => router.push(item.route as any)}
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name={item.icon as any} size={24} color="#fff" />
              <Text style={styles.menuItemText}>{item.title}</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#555" />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 16,
    paddingTop: 60,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 20,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    padding: 20,
    borderRadius: 12,
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 20,
  },
  profileInfo: {
    flex: 1,
  },
  username: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  premiumBadge: {
    backgroundColor: '#ffd700',
  },
  guestBadge: {
    backgroundColor: '#555555',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  menuContainer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 16,
  }
});
