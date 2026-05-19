import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/garage.dart';
import '../../models/user.dart';
import '../../services/api_service.dart';

class GarageDriversScreen extends ConsumerStatefulWidget {
  final Garage garage;
  
  const GarageDriversScreen({super.key, required this.garage});

  @override
  ConsumerState<GarageDriversScreen> createState() => _GarageDriversScreenState();
}

class _GarageDriversScreenState extends ConsumerState<GarageDriversScreen> {
  final ApiService _apiService = ApiService();
  List<User> _drivers = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadDrivers();
  }

  Future<void> _loadDrivers() async {
    setState(() => _isLoading = true);
    try {
      final allUsers = await _apiService.getAllUsersSuperAdmin();
      setState(() {
        _drivers = allUsers.where((u) => 
          u.role == UserRole.driver && u.garageId == widget.garage.id
        ).toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Chauffeurs - ${widget.garage.name}'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _drivers.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.people_outline, size: 64, color: Colors.grey),
                      SizedBox(height: 16),
                      Text('Aucun chauffeur assigné à ce garage'),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _drivers.length,
                  itemBuilder: (context, index) {
                    final driver = _drivers[index];
                    return Card(
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: driver.role.color.withAlpha(25),
                          child: Icon(driver.role.icon, color: driver.role.color),
                        ),
                        title: Text(driver.fullName),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(driver.phone),
                            if (driver.vehiclePlate != null && driver.vehiclePlate!.isNotEmpty)
                              Text('Plaque: ${driver.vehiclePlate}', style: const TextStyle(fontSize: 12)),
                          ],
                        ),
                        trailing: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: driver.status.color.withAlpha(25),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            driver.status.label,
                            style: TextStyle(fontSize: 12, color: driver.status.color),
                          ),
                        ),
                        onTap: () {
                          // Naviguer vers les détails du chauffeur
                        },
                      ),
                    );
                  },
                ),
    );
  }
}