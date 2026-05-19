// mobile/lib/screens/garage_admin/garage_admin_drivers_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/user.dart';
import '../../services/api_service.dart';

class GarageAdminDriversScreen extends ConsumerStatefulWidget {
  const GarageAdminDriversScreen({super.key});

  @override
  ConsumerState<GarageAdminDriversScreen> createState() => _GarageAdminDriversScreenState();
}

class _GarageAdminDriversScreenState extends ConsumerState<GarageAdminDriversScreen> {
  final ApiService _apiService = ApiService();
  List<User> _drivers = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDrivers();
  }

  Future<void> _loadDrivers() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final drivers = await _apiService.getGarageDrivers();
      setState(() {
        _drivers = drivers;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mes chauffeurs'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadDrivers,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 64, color: Colors.red),
                      const SizedBox(height: 16),
                      Text('Erreur: $_error'),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadDrivers,
                        child: const Text('Réessayer'),
                      ),
                    ],
                  ),
                )
              : _drivers.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.people_outline, size: 64, color: Colors.grey),
                          SizedBox(height: 16),
                          Text('Aucun chauffeur dans ce garage'),
                          SizedBox(height: 8),
                          Text('Contactez le super administrateur', style: TextStyle(fontSize: 12, color: Colors.grey)),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _drivers.length,
                      itemBuilder: (context, index) {
                        final driver = _drivers[index];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 12),
                          elevation: 2,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          child: ExpansionTile(
                            leading: CircleAvatar(
                              backgroundColor: _getDriverStatusColor(driver.driverStatus).withAlpha(25),
                              child: Icon(Icons.person, color: _getDriverStatusColor(driver.driverStatus)),
                            ),
                            title: Text(driver.fullName, style: const TextStyle(fontWeight: FontWeight.bold)),
                            subtitle: Text(driver.phone),
                            trailing: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _getDriverStatusColor(driver.driverStatus).withAlpha(25),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                driver.driverStatus?.label ?? 'Disponible',
                                style: TextStyle(fontSize: 11, color: _getDriverStatusColor(driver.driverStatus)),
                              ),
                            ),
                            children: [
                              Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  children: [
                                    _InfoRow(label: 'Email', value: driver.email),
                                    _InfoRow(label: 'Téléphone', value: driver.phone),
                                    if (driver.vehiclePlate != null && driver.vehiclePlate!.isNotEmpty)
                                      _InfoRow(label: 'Plaque', value: driver.vehiclePlate!),
                                    if (driver.vehicleModel != null && driver.vehicleModel!.isNotEmpty)
                                      _InfoRow(label: 'Modèle', value: driver.vehicleModel!),
                                    _InfoRow(label: 'Statut', value: driver.driverStatus?.label ?? 'Disponible'),
                                    _InfoRow(label: 'Inscription', value: _formatDate(driver.createdAt)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
    );
  }

  Color _getDriverStatusColor(DriverStatus? status) {
    if (status == null) return Colors.green;
    switch (status) {
      case DriverStatus.available:
        return Colors.green;
      case DriverStatus.busy:
        return Colors.orange;
      case DriverStatus.offline:
        return Colors.red;
    }
  }

  Widget _InfoRow({required String label, required String value}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(color: Colors.grey, fontSize: 13)),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }
}