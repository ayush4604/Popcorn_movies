import { StyleSheet, Text, View, Switch, TouchableOpacity, Alert } from 'react-native';
import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [cellular, setCellular] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const router = useRouter();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_settings');
      if (stored) {
        const s = JSON.parse(stored);
        setNotifications(s.notifications);
        setCellular(s.cellular);
        setAutoplay(s.autoplay);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveSettings = async (key: string, value: boolean) => {
    try {
      const current = { notifications, cellular, autoplay, [key]: value };
      await AsyncStorage.setItem('popcorn_settings', JSON.stringify(current));
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to log out? This will clear local data.", [
      { text: "Cancel", style: "cancel" },
      { 
        text: "Logout", 
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.clear();
          router.replace('/');
        }
      }
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        
        <View style={styles.row}>
          <Text style={styles.label}>Push Notifications</Text>
          <Switch 
            value={notifications} 
            onValueChange={(v) => { setNotifications(v); saveSettings('notifications', v); }} 
            trackColor={{ false: '#333', true: '#e50914' }}
          />
        </View>
        
        <View style={styles.row}>
          <Text style={styles.label}>Stream on Cellular Data</Text>
          <Switch 
            value={cellular} 
            onValueChange={(v) => { setCellular(v); saveSettings('cellular', v); }} 
            trackColor={{ false: '#333', true: '#e50914' }}
          />
        </View>
        
        <View style={styles.row}>
          <Text style={styles.label}>Autoplay Next Episode</Text>
          <Switch 
            value={autoplay} 
            onValueChange={(v) => { setAutoplay(v); saveSettings('autoplay', v); }} 
            trackColor={{ false: '#333', true: '#e50914' }}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  section: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    textTransform: 'uppercase',
    marginBottom: 16,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  label: {
    color: '#fff',
    fontSize: 16,
  },
  logoutBtn: {
    backgroundColor: '#2a2a2a',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutText: {
    color: '#e50914',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
