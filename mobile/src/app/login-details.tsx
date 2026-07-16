import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert } from 'react-native';
import React, { useState } from 'react';
import { useRouter } from 'expo-router';

export default function LoginDetailsScreen() {
  const [email, setEmail] = useState('guest@popcorn.movies');
  const [password, setPassword] = useState('********');
  const router = useRouter();

  const handleSave = () => {
    Alert.alert("Notice", "Login details updated successfully. (Mocked for guest accounts)");
    router.back();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.infoText}>Update your login credentials below.</Text>
      
      <Text style={styles.label}>Email Address</Text>
      <TextInput 
        style={styles.input} 
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      
      <Text style={styles.label}>Password</Text>
      <TextInput 
        style={styles.input} 
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Update Credentials</Text>
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
  infoText: {
    color: '#aaa',
    fontSize: 14,
    marginBottom: 20,
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
    backgroundColor: '#0088cc',
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
