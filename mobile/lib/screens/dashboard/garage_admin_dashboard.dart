// mobile/lib/screens/dashboard/garage_admin_dashboard.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/screens/profile/profile_screen.dart';

import '../../models/parcel.dart';
import '../../models/user.dart';
import '../../services/api_service.dart';

class GarageAdminDashboard extends ConsumerStatefulWidget {
  const GarageAdminDashboard({super.key});

  @override
ConsumerState<GarageAdminDashboard> createState() => _GarageAdminDashboardState();
}

class _GarageAdminDashboardState extends ConsumerState<GarageAdminDashboard> {
  final ApiService _apiService = ApiService();
  List<Parcel> _parcels = [];
  List<User> _drivers = [];
  bool _isLoading = true;
  String? _error;
  int _selectedIndex = 0;
  User? _currentAdmin;

  @override
  void initState() {
    super.initState();
    _loadData();
    _loadCurrentAdmin();
  }

  Future<void> _loadCurrentAdmin() async {
    try {
      final admin = await _apiService.getCurrentUser();
      if (mounted) {
        setState(() {
          _currentAdmin = admin;
        });
      }
    } catch (e) {
      debugPrint('Erreur chargement admin: $e');
    }
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final parcels = await _apiService.getGarageParcels();
      final drivers = await _apiService.getGarageDrivers();
      
      if (mounted) {
        setState(() {
          _parcels = parcels;
          _drivers = drivers;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Erreur détaillée: $e');
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  int get _pendingCount => _parcels.where((p) => p.status == ParcelStatus.pending).length;
  int get _inProgressCount => _parcels.where((p) => p.isInProgress).length;
  int get _completedCount => _parcels.where((p) => p.isDelivered).length;
  int get _availableDriversCount => _drivers.where((d) => d.isDriverAvailable).length;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard Garage'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.person),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const ProfileScreen()),
              );
            },
            tooltip: 'Mon profil',
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
            tooltip: 'Actualiser',
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
                      Text('Erreur: $_error', textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        child: const Text('Réessayer'),
                      ),
                    ],
                  ),
                )
              : Column(
                  children: [
                    _buildHeader(),
                    _buildStatsRow(),
                    Expanded(
                      child: IndexedStack(
                        index: _selectedIndex,
                        children: [
                          _PendingParcelsTab(parcels: _parcels, drivers: _drivers, onRefresh: _loadData),
                          _DriversTab(drivers: _drivers, onRefresh: _loadData),
                          _InProgressTab(parcels: _parcels, onRefresh: _loadData),
                          _HistoryTab(parcels: _parcels, onRefresh: _loadData),
                        ],
                      ),
                    ),
                  ],
                ),
      bottomNavigationBar: BottomNavigationBar(
        type: BottomNavigationBarType.fixed,
        currentIndex: _selectedIndex,
        onTap: (index) => setState(() => _selectedIndex = index),
        selectedItemColor: const Color(0xFF0B6E3A),
        unselectedItemColor: Colors.grey,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.pending),
            label: 'En attente',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.people),
            label: 'Chauffeurs',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.local_shipping),
            label: 'En cours',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.history),
            label: 'Historique',
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: const Color(0xFF0B6E3A),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Bienvenue ${_currentAdmin?.fullName ?? "Admin"}',
            style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            '${_parcels.length} colis total | ${_drivers.length} chauffeurs',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          _buildStatChip('En attente', _pendingCount, Colors.orange),
          const SizedBox(width: 12),
          _buildStatChip('En cours', _inProgressCount, Colors.blue),
          const SizedBox(width: 12),
          _buildStatChip('Livrés', _completedCount, Colors.green),
          const SizedBox(width: 12),
          _buildStatChip('Chauffeurs dispo', _availableDriversCount, Colors.teal),
        ],
      ),
    );
  }

  Widget _buildStatChip(String label, int count, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          children: [
            Text(
              count.toString(),
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color),
            ),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 10, color: color)),
          ],
        ),
      ),
    );
  }
}

// Onglet Colis en attente
class _PendingParcelsTab extends StatefulWidget {
  final List<Parcel> parcels;
  final List<User> drivers;
  final Future<void> Function() onRefresh;

  const _PendingParcelsTab({
    required this.parcels,
    required this.drivers,
    required this.onRefresh,
  });

  @override
  State<_PendingParcelsTab> createState() => _PendingParcelsTabState();
}

class _PendingParcelsTabState extends State<_PendingParcelsTab> {
  final ApiService _apiService = ApiService();
  String? _selectedParcelId;
  bool _isAssigning = false;

  List<Parcel> get _pendingParcels {
    return widget.parcels.where((p) => p.status == ParcelStatus.pending).toList();
  }

  Future<void> _assignDriver(String parcelId, String driverId) async {
    if (driverId.isEmpty) return;
    
    // Vérifier si le chauffeur est disponible
    final selectedDriver = widget.drivers.firstWhere((d) => d.id == driverId);
    if (selectedDriver.driverStatus != DriverStatus.available) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Ce chauffeur n\'est pas disponible actuellement'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }
    
    setState(() {
      _selectedParcelId = parcelId;
      _isAssigning = true;
    });
    
    try {
      final Map<String, dynamic> result = await _apiService.assignDriverToParcel(parcelId, driverId);
      if (mounted) {
        if (result['success'] == true) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Chauffeur assigné avec succès'), backgroundColor: Colors.green),
          );
          await widget.onRefresh();
        } else {
          final errorMessage = result['message'] ?? 'Erreur lors de l\'assignation';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(errorMessage), backgroundColor: Colors.red),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _selectedParcelId = null;
          _isAssigning = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasAvailableDrivers = widget.drivers.any((d) => d.driverStatus == DriverStatus.available);
    
    if (_pendingParcels.isEmpty) {
      return RefreshIndicator(
        onRefresh: widget.onRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: MediaQuery.of(context).size.height - 200,
            child: const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.inbox, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('Aucun colis en attente'),
                  SizedBox(height: 8),
                  Text('Les nouveaux colis apparaîtront ici', style: TextStyle(fontSize: 12, color: Colors.grey)),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _pendingParcels.length,
        itemBuilder: (context, index) {
          final parcel = _pendingParcels[index];
          final isLoading = _selectedParcelId == parcel.id && _isAssigning;
          
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          parcel.trackingNumber,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, fontFamily: 'monospace'),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.orange.withAlpha(25),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Text('En attente', style: TextStyle(fontSize: 11, color: Colors.orange)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.person, size: 16, color: Colors.grey),
                      const SizedBox(width: 4),
                      Expanded(child: Text('Destinataire: ${parcel.receiverName}')),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(Icons.description, size: 16, color: Colors.grey),
                      const SizedBox(width: 4),
                      Expanded(child: Text(parcel.description, maxLines: 1, overflow: TextOverflow.ellipsis)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(Icons.fitness_center, size: 16, color: Colors.grey),
                      const SizedBox(width: 4),
                      Text('${parcel.weight} kg'),
                      const SizedBox(width: 16),
                      if (parcel.price != null)
                        Row(
                          children: [
                            const Icon(Icons.money, size: 16, color: Colors.grey),
                            const SizedBox(width: 4),
                            Text('${parcel.price!.toInt()} FCFA'),
                          ],
                        ),
                    ],
                  ),
                  const Divider(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          isExpanded: true,
                          hint: Text(hasAvailableDrivers ? 'Assigner un chauffeur' : 'Aucun chauffeur disponible'),
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(8))),
                            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                          items: widget.drivers.where((d) => d.driverStatus == DriverStatus.available).map((driver) {
                            return DropdownMenuItem(
                              value: driver.id,
                              child: Row(
                                children: [
                                  const Icon(Icons.person, size: 16, color: Colors.green),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(driver.fullName)),
                                ],
                              ),
                            );
                          }).toList(),
                          onChanged: (isLoading || !hasAvailableDrivers) ? null : (driverId) {
                            if (driverId != null) {
                              _assignDriver(parcel.id, driverId);
                            }
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      if (isLoading)
                        const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)),
                    ],
                  ),
                  if (!hasAvailableDrivers)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.orange.withAlpha(25),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.warning, size: 16, color: Colors.orange),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Aucun chauffeur disponible. Contactez le super administrateur.',
                                style: TextStyle(fontSize: 12, color: Colors.orange),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// Onglet Chauffeurs
class _DriversTab extends StatelessWidget {
  final List<User> drivers;
  final Future<void> Function() onRefresh;

  const _DriversTab({required this.drivers, required this.onRefresh});

  void _showDriverDetails(BuildContext context, User driver) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(driver.fullName),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ListTile(
              leading: const Icon(Icons.phone),
              title: const Text('Téléphone'),
              subtitle: Text(driver.phone),
            ),
            if (driver.vehiclePlate != null && driver.vehiclePlate!.isNotEmpty)
              ListTile(
                leading: const Icon(Icons.directions_car),
                title: const Text('Plaque d\'immatriculation'),
                subtitle: Text(driver.vehiclePlate!),
              ),
            if (driver.vehicleModel != null && driver.vehicleModel!.isNotEmpty)
              ListTile(
                leading: const Icon(Icons.car_repair),
                title: const Text('Modèle du véhicule'),
                subtitle: Text(driver.vehicleModel!),
              ),
            ListTile(
              leading: const Icon(Icons.badge),
              title: const Text('Statut'),
              subtitle: Text(driver.driverStatus?.label ?? 'Disponible'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Fermer'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (drivers.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: MediaQuery.of(context).size.height - 200,
            child: const Center(
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
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: drivers.length,
        itemBuilder: (context, index) {
          final driver = drivers[index];
          final isAvailable = driver.driverStatus == DriverStatus.available;
          
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: InkWell(
              onTap: () => _showDriverDetails(context, driver),
              borderRadius: BorderRadius.circular(12),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: _getDriverStatusColor(driver.driverStatus).withAlpha(25),
                  child: Icon(Icons.person, color: _getDriverStatusColor(driver.driverStatus)),
                ),
                title: Text(
                  driver.fullName,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(driver.phone, style: const TextStyle(fontSize: 12)),
                    if (driver.vehiclePlate != null && driver.vehiclePlate!.isNotEmpty)
                      Text('Plaque: ${driver.vehiclePlate}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                  ],
                ),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _getDriverStatusColor(driver.driverStatus).withAlpha(25),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (isAvailable)
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(right: 4),
                          decoration: const BoxDecoration(
                            color: Colors.green,
                            shape: BoxShape.circle,
                          ),
                        ),
                      Text(
                        driver.driverStatus?.label ?? 'Disponible',
                        style: TextStyle(
                          fontSize: 11,
                          color: _getDriverStatusColor(driver.driverStatus),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
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
}

// Onglet Colis en cours
class _InProgressTab extends StatelessWidget {
  final List<Parcel> parcels;
  final Future<void> Function() onRefresh;

  const _InProgressTab({required this.parcels, required this.onRefresh});

  List<Parcel> get _inProgressParcels {
    return parcels.where((p) => p.isInProgress).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (_inProgressParcels.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: MediaQuery.of(context).size.height - 200,
            child: const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.local_shipping, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('Aucun colis en cours'),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _inProgressParcels.length,
        itemBuilder: (context, index) {
          final parcel = _inProgressParcels[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: parcel.status.color.withAlpha(25),
                child: Icon(Icons.local_shipping, color: parcel.status.color),
              ),
              title: Text(parcel.trackingNumber, style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text('${parcel.receiverName} - ${parcel.status.label}'),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (parcel.driverName != null)
                    Text(parcel.driverName!, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                  Container(
                    margin: const EdgeInsets.only(top: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: parcel.status.color.withAlpha(25),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      parcel.status.label,
                      style: TextStyle(fontSize: 10, color: parcel.status.color),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// Onglet Historique
class _HistoryTab extends StatelessWidget {
  final List<Parcel> parcels;
  final Future<void> Function() onRefresh;

  const _HistoryTab({required this.parcels, required this.onRefresh});

  List<Parcel> get _historyParcels {
    return parcels.where((p) => p.isDelivered || p.isCancelled).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (_historyParcels.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: MediaQuery.of(context).size.height - 200,
            child: const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.history, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('Aucun historique'),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _historyParcels.length,
        itemBuilder: (context, index) {
          final parcel = _historyParcels[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 1,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: parcel.status.color.withAlpha(25),
                child: Icon(parcel.isDelivered ? Icons.check_circle : Icons.cancel, 
                    color: parcel.status.color),
              ),
              title: Text(parcel.trackingNumber, style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text('${parcel.receiverName} - ${_formatDate(parcel.createdAt)}'),
              trailing: Text(
                parcel.status.label,
                style: TextStyle(color: parcel.status.color, fontWeight: FontWeight.bold),
              ),
            ),
          );
        },
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }
}