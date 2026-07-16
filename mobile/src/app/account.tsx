import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert } from 'react-native';
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

export default function AccountDetailsScreen() {
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const router = useRouter();

  useEffect(() => {
    loadAccount();
  }, []);

  const loadAccount = async () => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_account');
      if (stored) {
        const acc = JSON.parse(stored);
        setUsername(acc.username || '');
        setAvatar(acc.avatar || '');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    try {
      const stored = await AsyncStorage.getItem('popcorn_account');
      if (stored) {
        const acc = JSON.parse(stored);
        acc.username = username;
        acc.avatar = avatar;
        await AsyncStorage.setItem('popcorn_account', JSON.stringify(acc));
        Alert.alert("Success", "Account details updated!");
        router.back();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Username</Text>
      <TextInput 
        style={styles.input} 
        value={username}
        onChangeText={setUsername}
        placeholder="Enter username"
        placeholderTextColor="#666"
      />
      
      <Text style={styles.label}>Avatar URL</Text>
      <TextInput 
        style={styles.input} 
        value={avatar}
        onChangeText={setAvatar}
        placeholder="https://example.com/avatar.png"
        placeholderTextColor="#666"
      />

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save Changes</Text>
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
  label: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1e1e1e',
    color: '#fff',
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#e50914',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
